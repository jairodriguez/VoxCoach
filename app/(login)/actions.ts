'use client'; // Marking as a client module boundary, though actions are server-side

// Re-export only the functions needed by client components
// These functions are defined in actions.server.ts
export {
  signIn,
  signInWithGoogle,
  signUp,
  signOut,
  updateAccount,
  updatePassword,
  deleteAccount,
  inviteTeamMember,
  removeTeamMember
} from './actions.server';
