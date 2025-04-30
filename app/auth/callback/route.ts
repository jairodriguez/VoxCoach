import { createClient } from '@/utils/supabase/server';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const redirectTo = requestUrl.searchParams.get('redirect');
  const priceId = requestUrl.searchParams.get('priceId');
  const inviteId = requestUrl.searchParams.get('inviteId');

  if (code) {
    const cookieStore = cookies();
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Construct the redirect URL with original parameters
      let redirectPath = redirectTo || '/dashboard';
      if (priceId) {
        redirectPath += `?priceId=${priceId}`;
      }
      if (inviteId) {
        redirectPath += `${priceId ? '&' : '?'}inviteId=${inviteId}`;
      }

      return NextResponse.redirect(`${requestUrl.origin}${redirectPath}`);
    }
  }

  // Return to the original url with error
  const redirectPath = redirectTo || '/';
  return NextResponse.redirect(
    `${requestUrl.origin}${redirectPath}${redirectPath.includes('?') ? '&' : '?'}error=oauth_error`
  );
}
