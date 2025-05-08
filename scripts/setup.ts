import { writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { config } from 'dotenv';
import { join } from 'path';
import { randomBytes } from 'crypto';
export const runtime = 'nodejs';

// Load existing .env file if it exists
const envPath = join(process.cwd(), '.env');
if (existsSync(envPath)) {
  config({ path: envPath });
}

// Function to validate Postgres URL format
function validatePostgresUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return urlObj.protocol === 'postgres:' || urlObj.protocol === 'postgresql:';
  } catch {
    return false;
  }
}

// Function to format Postgres URL
function formatPostgresUrl(url: string): string {
  // Remove any whitespace
  url = url.trim();
  
  // If URL doesn't start with postgres:// or postgresql://, add it
  if (!url.startsWith('postgres://') && !url.startsWith('postgresql://')) {
    url = `postgres://${url}`;
  }
  
  return url;
}

async function setup() {
  console.log('🚀 Starting VoxCoach setup...\n');

  // 1. Check if .env file exists
  if (existsSync(envPath)) {
    console.log('📝 .env file already exists. Checking configuration...');
  } else {
    console.log('📝 Creating .env file...');
  }

  // 2. Get Supabase configuration
  let supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  let supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let postgresUrl = process.env.POSTGRES_URL;

  if (!supabaseUrl || !supabaseAnonKey || !postgresUrl) {
    console.log('\n🔧 Please enter your Supabase configuration:');
    
    if (!supabaseUrl) {
      supabaseUrl = await prompt('Enter your Supabase project URL: ');
    }
    
    if (!supabaseAnonKey) {
      supabaseAnonKey = await prompt('Enter your Supabase anon key: ');
    }
    
    if (!postgresUrl) {
      postgresUrl = await prompt('Enter your Supabase Postgres connection string: ');
    }
  }

  // Format and validate Postgres URL
  postgresUrl = formatPostgresUrl(postgresUrl);
  if (!validatePostgresUrl(postgresUrl)) {
    console.error('❌ Invalid Postgres URL format. Please make sure it starts with postgres:// or postgresql://');
    process.exit(1);
  }

  // 3. Generate auth secret if not exists
  const authSecret = process.env.AUTH_SECRET || randomBytes(32).toString('hex');

  // 4. Create .env file
  const envContent = `# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=${supabaseUrl}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${supabaseAnonKey}
POSTGRES_URL=${postgresUrl}

# Authentication
AUTH_SECRET=${authSecret}

# Base URL (for development)
BASE_URL=http://localhost:3000
`;

  writeFileSync(envPath, envContent);
  console.log('✅ .env file created successfully!');

  // 5. Install dependencies
  console.log('\n📦 Installing dependencies...');
  try {
    execSync('pnpm install', { stdio: 'inherit' });
    console.log('✅ Dependencies installed successfully!');
  } catch (error) {
    console.error('❌ Error installing dependencies:', error);
    process.exit(1);
  }

  // 6. Run database migrations
  console.log('\n🔄 Running database migrations...');
  try {
    execSync('pnpm db:push', { stdio: 'inherit' });
    console.log('✅ Database migrations completed successfully!');
  } catch (error) {
    console.error('❌ Error running database migrations:', error);
    process.exit(1);
  }

  console.log('\n✨ Setup completed successfully! You can now run the development server with:');
  console.log('pnpm dev');
}

// Helper function to prompt for user input
function prompt(question: string): Promise<string> {
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    readline.question(question, (answer: string) => {
      readline.close();
      resolve(answer);
    });
  });
}

setup().catch((error) => {
  console.error('❌ Setup failed:', error);
  process.exit(1);
}); 