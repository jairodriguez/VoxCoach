import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

if (!process.env.POSTGRES_URL) {
  throw new Error('POSTGRES_URL environment variable is not set');
}

async function main() {
  const client = postgres(process.env.POSTGRES_URL, {
    ssl: {
      rejectUnauthorized: false
    },
    max: 1
  });

  // Drop all tables in the correct order to avoid foreign key constraints
  console.log('Dropping existing tables...');
  try {
    const dropTables = [
      'invitations',
      'activity_logs',
      'team_members',
      'teams',
      'users',
      '__drizzle_migrations'
    ];

    for (const table of dropTables) {
      await client.unsafe(`DROP TABLE IF EXISTS ${table} CASCADE`);
    }
    console.log('Tables dropped successfully');
  } catch (error) {
    console.warn('Error dropping tables:', error);
    // Continue anyway as tables might not exist
  }

  const db = drizzle(client);

  console.log('Running migrations...');
  try {
    await migrate(db, {
      migrationsFolder: path.join(process.cwd(), 'drizzle')
    });
    console.log('Migrations completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
}); 