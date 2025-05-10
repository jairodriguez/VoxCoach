'use server';

import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import {
  User,
  users,
  teams,
  teamMembers,
  activityLogs,
  type NewUser,
  type NewTeam,
  type NewTeamMember,
  type NewActivityLog,
  ActivityType,
  invitations
} from '@/lib/db/schema';
import { comparePasswords, hashPassword, setSession } from '@/lib/auth/session';
import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import { createCheckoutSession } from '@/lib/payments/stripe';
import { getUser, getUserWithTeam } from '@/lib/db/queries';
import {
  validatedAction,
  validatedActionWithUser
} from '@/lib/auth/middleware';
import { createClient } from '@/utils/supabase/server';

async function logActivity(
  teamId: number | null | undefined,
  userId: string,
  type: ActivityType,
  ipAddress?: string
) {
  if (teamId === null || teamId === undefined) {
    return;
  }
  const newActivity: NewActivityLog = {
    teamId,
    userId,
    action: type,
    ipAddress: ipAddress || ''
  };
  await db.insert(activityLogs).values(newActivity);
}

const signInSchema = z.object({
  email: z.string().email().min(3).max(255),
  password: z.string().min(8).max(100)
});

export const signIn = validatedAction(signInSchema, async (data, formData) => {
  const { email, password } = data;

  const userWithTeam = await db
    .select({
      user: users,
      team: teams
    })
    .from(users)
    .leftJoin(teamMembers, eq(users.id, teamMembers.userId))
    .leftJoin(teams, eq(teamMembers.teamId, teams.id))
    .where(eq(users.email, email))
    .limit(1);

  if (userWithTeam.length === 0) {
    return {
      error: 'Invalid email or password. Please try again.',
      email,
      password
    };
  }

  const { user: foundUser, team: foundTeam } = userWithTeam[0];

  const isPasswordValid = await comparePasswords(
    password,
    foundUser.passwordHash
  );

  if (!isPasswordValid) {
    return {
      error: 'Invalid email or password. Please try again.',
      email,
      password
    };
  }

  await Promise.all([
    setSession(foundUser),
    logActivity(foundTeam?.id ? Number(foundTeam.id) : null, String(foundUser.id), ActivityType.SIGN_IN)
  ]);

  const redirectTo = formData.get('redirect') as string | null;
  if (redirectTo === 'checkout') {
    const priceId = formData.get('priceId') as string;
    return createCheckoutSession({ team: foundTeam, priceId });
  }

  redirect('/dashboard');
});

// New server action for Google OAuth sign-in
export async function signInWithGoogle(formData: FormData) {
  const origin = (await headers()).get('origin');
  const redirectTo = formData.get('redirect') as string | null;
  const priceId = formData.get('priceId') as string | null;
  const inviteId = formData.get('inviteId') as string | null;

  const supabase = await createClient(); // Await createClient()

  // Construct the callback URL with original parameters
  const callbackUrl = `${origin}/auth/callback?redirect=${redirectTo || ''}${priceId ? `&priceId=${priceId}` : ''}${inviteId ? `&inviteId=${inviteId}` : ''}`;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: callbackUrl,
    },
  });

  if (error) {
    console.error('Error signing in with Google:', error);
    // Handle error, perhaps redirecting back to login with an error message
    redirect('/sign-in?error=oauth_error');
  }

  if (data.url) {
    // Redirect to Google OAuth consent page
    redirect(data.url);
  }
}

const signUpSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  inviteId: z.string().optional()
});

export const signUp = async (prevState: any, formData: FormData) => {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const inviteId = formData.get('inviteId') as string | null;

  console.log('Starting sign-up process for:', email);
  console.log('Environment variables check:');
  console.log('NEXT_PUBLIC_SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL);
  console.log('NEXT_PUBLIC_SUPABASE_ANON_KEY:', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.slice(0, 10) + '...');

  try {
    const supabase = await createClient();
    console.log('Supabase client created successfully');

    console.log('Attempting to sign up with Supabase...');
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
        data: {
          email: email,
        }
      }
    });

    if (authError) {
      console.error('Supabase auth error:', authError);
      return {
        error: authError.message,
        email,
        password,
      };
    }

    if (!authData.user) {
      console.error('No user data returned from Supabase');
      return {
        error: 'Failed to create user',
        email,
        password,
      };
    }

    console.log('Supabase user created successfully:', authData.user.id);

    // Create user in our database
    const hashedPassword = await hashPassword(password);
    const newUser: NewUser = {
      id: authData.user.id,
      email: email,
      passwordHash: hashedPassword,
      role: 'member',
    };

    console.log('Creating user in database...');
    try {
      await db.insert(users).values(newUser);
      console.log('User created in database successfully');
    } catch (dbError: any) {
      // Check for duplicate email error
      if (dbError.code === '23505' && dbError.constraint === 'users_email_key') {
        return {
          error: 'User already exists.',
          email,
          password,
        };
      }
      // Log and return generic error for other DB errors
      console.error('Database error during user creation:', dbError);
      return {
        error: dbError.message || 'An unexpected error occurred during sign-up',
        email,
        password,
      };
    }

    // Handle invitation if present
    if (inviteId) {
      console.log('Processing invitation:', inviteId);
      const invitation = await db
        .select()
        .from(invitations)
        .where(eq(invitations.id, parseInt(inviteId)))
        .limit(1);

      if (invitation.length > 0) {
        const { teamId, role } = invitation[0];
        await db.insert(teamMembers).values({
          userId: authData.user.id,
          teamId: Number(teamId),
          role,
        });
        console.log('User added to team via invitation');
      }
    }

    // Set the session
    await setSession({
      ...newUser,
      id: authData.user.id,
    });
    console.log('Session set successfully');

    redirect('/dashboard');
  } catch (error) {
    console.error('Error during sign-up:', error);
    return {
      error: 'An unexpected error occurred during sign-up',
      email,
      password,
    };
  }
};

export async function signOut() {
  const user = (await getUser()) as User;
  const userWithTeam = await getUserWithTeam(user.id);
  await logActivity(userWithTeam?.teamId ? Number(userWithTeam.teamId) : null, String(user.id), ActivityType.SIGN_OUT);
  (await cookies()).delete('session');
  redirect('/sign-in');
}

const updateAccountSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email().min(3).max(255)
});

export const updateAccount = validatedActionWithUser(
  updateAccountSchema,
  async (data, _, user) => {
    const { name, email } = data;
    await db.update(users).set({ name, email }).where(eq(users.id, user.id));
    const userWithTeam = await getUserWithTeam(user.id);
    await logActivity(userWithTeam?.teamId, user.id, ActivityType.UPDATE_PROFILE);
    return { success: 'Account updated successfully' };
  }
);

const updatePasswordSchema = z
  .object({
    currentPassword: z.string().min(8).max(100),
    newPassword: z.string().min(8).max(100),
    confirmPassword: z.string().min(8).max(100)
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword']
  });

export const updatePassword = validatedActionWithUser(
  updatePasswordSchema,
  async (data, _, user) => {
    const { currentPassword, newPassword } = data;

    if (!user.passwordHash) {
      return { error: 'Password cannot be changed for OAuth users.' };
    }

    const isPasswordValid = await comparePasswords(
      currentPassword,
      user.passwordHash
    );

    if (!isPasswordValid) {
      return { error: 'Invalid current password.', currentPassword };
    }

    const newPasswordHash = await hashPassword(newPassword);
    await db
      .update(users)
      .set({ passwordHash: newPasswordHash })
      .where(eq(users.id, user.id));

    const userWithTeam = await getUserWithTeam(user.id);
    await logActivity(userWithTeam?.teamId, user.id, ActivityType.UPDATE_PASSWORD);

    return { success: 'Password updated successfully' };
  }
);

const deleteAccountSchema = z.object({
  password: z.string().min(8).max(100)
});

export const deleteAccount = validatedActionWithUser(
  deleteAccountSchema,
  async (data, _, user) => {
    const { password } = data;

    if (!user.passwordHash) {
      return { error: 'Account cannot be deleted for OAuth users.' };
    }

    const isPasswordValid = await comparePasswords(password, user.passwordHash);

    if (!isPasswordValid) {
      return { error: 'Invalid password.', password };
    }

    // Log activity before deleting user and team data
    const userWithTeam = await getUserWithTeam(user.id);
    await logActivity(userWithTeam?.teamId, user.id, ActivityType.DELETE_ACCOUNT);

    // Delete related data (adjust according to your schema and cascade rules)
    await db.delete(teamMembers).where(eq(teamMembers.userId, user.id));
    // If user is the only owner of a team, consider deleting the team or transferring ownership
    // For now, we will just delete the user
    await db.delete(users).where(eq(users.id, user.id));

    (await cookies()).delete('session');
    redirect('/sign-up'); // Redirect to sign-up or a "deleted account" page
  }
);

const inviteTeamMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['owner', 'member'])
});

export const inviteTeamMember = validatedActionWithUser(
  inviteTeamMemberSchema,
  async (data, _, user) => {
    const { email, role } = data;
    const userWithTeam = await getUserWithTeam(user.id);

    if (!userWithTeam || !userWithTeam.teamId) {
      return { error: 'You must be part of a team to invite members.' };
    }

    if (userWithTeam.role !== 'owner') {
      return { error: 'Only team owners can invite members.' };
    }

    // Check if user already exists
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existingUser.length > 0) {
      const existingMember = await db
        .select()
        .from(teamMembers)
        .where(
          and(
            eq(teamMembers.userId, existingUser[0].id),
            eq(teamMembers.teamId, Number(userWithTeam.teamId))
          )
        )
        .limit(1);

      if (existingMember.length > 0) {
        return { error: 'User is already a member of this team.' };
      }

      // Add existing user to team
      await db.insert(teamMembers).values({
        userId: existingUser[0].id,
        teamId: Number(userWithTeam.teamId),
        role
      });
    } else {
      // If user doesn't exist, create an invitation (you'll need an invitations table)
      // For simplicity, this example assumes an invitations table and process
      // This part would typically involve sending an email with an invite link
      await db.insert(invitations).values({
        teamId: Number(userWithTeam.teamId),
        email,
        role,
        invitedBy: user.id
      });
    }

    await logActivity(
      userWithTeam.teamId,
      user.id,
      ActivityType.INVITE_MEMBER,
      email // Log invited email as metadata
    );

    return { success: 'Invitation sent successfully.' };
  }
);

const removeTeamMemberSchema = z.object({
  memberId: z.string() // Assuming memberId is the ID from the teamMembers table
});

export const removeTeamMember = validatedActionWithUser(
  removeTeamMemberSchema,
  async (data, _, user) => {
    const { memberId } = data;
    const userWithTeam = await getUserWithTeam(user.id);

    if (!userWithTeam || !userWithTeam.teamId) {
      return { error: 'You must be part of a team.' };
    }

    if (userWithTeam.role !== 'owner') {
      return { error: 'Only team owners can remove members.' };
    }

    const memberToRemove = await db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.id, parseInt(memberId)), eq(teamMembers.teamId, Number(userWithTeam.teamId))))
      .limit(1);

    if (memberToRemove.length === 0) {
      return { error: 'Team member not found.' };
    }

    if (memberToRemove[0].userId === user.id) {
      return { error: 'You cannot remove yourself from the team.' };
    }

    await db.delete(teamMembers).where(eq(teamMembers.id, parseInt(memberId)));

    await logActivity(
      userWithTeam.teamId,
      user.id,
      ActivityType.REMOVE_MEMBER,
      memberToRemove[0].userId // Log removed member's ID as metadata
    );

    return { success: 'Team member removed successfully.' };
  }
); 