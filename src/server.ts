// DEPRECATED: This file is from the old pipeline architecture.
// The new hybrid pipeline uses:
//   - src/bridge-server.ts (receives prompts from n8n)
//   - src/watcher.ts (processes tasks and uploads to Supabase)
//
// To run the new pipeline:
//   Terminal 1: npm run bridge
//   Terminal 2: npm run worker

console.log("⚠️  This server is deprecated.");
console.log("Please use the new hybrid pipeline:");
console.log("  npm run bridge  - Start the n8n bridge server (port 4000)");
console.log("  npm run worker  - Start the task watcher/processor");