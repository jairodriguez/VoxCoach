import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/payments/stripe';
import Stripe from 'stripe';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const sessionId = searchParams.get('session_id');

  if (!sessionId) {
    return NextResponse.redirect(new URL('/pricing', request.url));
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['customer', 'subscription'],
    });

    if (!session.customer || typeof session.customer === 'string') {
      throw new Error('Invalid customer data from Stripe.');
    }

    const customerId = session.customer.id;
    const subscriptionId =
      typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id;

    if (!subscriptionId) {
      throw new Error('No subscription found for this session.');
    }

    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['items.data.price.product'],
    });

    const plan = subscription.items.data[0]?.price;

    if (!plan) {
      throw new Error('No plan found for this subscription.');
    }

    const productId = (plan.product as Stripe.Product).id;

    if (!productId) {
      throw new Error('No product ID found for this subscription.');
    }

    const userId = session.client_reference_id;
    if (!userId) {
      throw new Error("No user ID found in session's client_reference_id.");
    }

    // Rewrite Drizzle query to Supabase client query
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', Number(userId))
      .single();

    if (userError || !userData) {
      console.error('Error fetching user:', userError?.message);
      throw new Error('User not found in database.');
    }

    // Rewrite Drizzle query to Supabase client query
    const { data: userTeamData, error: userTeamError } = await supabase
      .from('teamMembers')
      .select('teamId')
      .eq('userId', userData.id)
      .single();

    if (userTeamError || !userTeamData) {
      console.error('Error fetching user team:', userTeamError?.message);
      throw new Error('User is not associated with any team.');
    }

    // Rewrite Drizzle update to Supabase client update
    const { error: updateError } = await supabase
      .from('teams')
      .update({
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        stripeProductId: productId,
        planName: (plan.product as Stripe.Product).name,
        subscriptionStatus: subscription.status,
        updatedAt: new Date(),
      })
      .eq('id', userTeamData.teamId);

    if (updateError) {
      console.error('Error updating team:', updateError.message);
      throw updateError;
    }

    // Assuming setSession needs the user object structure, it might need adjustment
    // if the Supabase client's returned user object is different from Drizzle's.
    // For now, I'm passing the userData object from Supabase.
    await setSession(userData);

    return NextResponse.redirect(new URL('/dashboard', request.url));
  } catch (error) {
    console.error('Error handling successful checkout:', error);
    return NextResponse.redirect(new URL('/error', request.url));
  }
}

import { setSession } from '@/lib/auth/session'; // Keep setSession import
