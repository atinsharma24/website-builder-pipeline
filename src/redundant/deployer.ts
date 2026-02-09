import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { v4 as uuidv4 } from 'uuid';

export async function deployToDaytona(htmlCode: string) {
    // 1. Create a unique ID for this user request
    const runId = uuidv4();
    const projectDir = path.join(__dirname, `../temp/${runId}`);

    // 2. Create the folder and file
    if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'index.html'), htmlCode);

    console.log(`[${runId}] Deploying to Daytona...`);

    try {
        // 3. Execute Daytona Create Command
        // NOTE: This assumes your server has the Daytona CLI authenticated!
        const cmd = `daytona create ${projectDir} --target=us-east-1 --yes`;
        const output = execSync(cmd, { encoding: 'utf-8' });

        // 4. Extract URL using Regex (Parses Daytona CLI output)
        const urlMatch = output.match(/https:\/\/[a-z0-9-]+\.daytona\.app[^\s]*/);
        return urlMatch ? urlMatch[0] : null;

    } catch (error) {
        console.error("Daytona Deployment Failed:", error);
        return null;
    } finally {
        // 5. Cleanup: Remove temp directory
        try {
            fs.rmSync(projectDir, { recursive: true, force: true });
            console.log(`[${runId}] Cleaned up temp directory.`);
        } catch (cleanupError) {
            console.warn(`[${runId}] Failed to cleanup temp directory:`, cleanupError);
        }
    }
}