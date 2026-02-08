import Fastify from 'fastify';
import { runArchitect, runBuilder, runAuditor } from './agents';
import { deployToDaytona } from './deployer';

const server = Fastify({ logger: true });

server.post('/build-site', async (request, reply) => {
    const { user_message } = request.body as { user_message: string };

    if (!user_message) return reply.code(400).send({ error: "Message required" });

    console.log(`🚀 Starting Pipeline for: "${user_message}"`);

    // --- PHASE 1: ARCHITECT ---
    const spec = await runArchitect(user_message);
    console.log("✅ Architect Spec Created");

    let currentCode = "";
    let auditPassed = false;
    let attempts = 0;
    let feedback = "";

    // --- PHASE 2 & 3: BUILD/AUDIT LOOP ---
    while (!auditPassed && attempts < 3) {
        attempts++;
        console.log(`⚙️ Build Attempt ${attempts}...`);

        // Build
        currentCode = await runBuilder(spec, feedback);

        // Audit
        const auditResult = await runAuditor(currentCode);

        if (auditResult.passed) {
            console.log("✅ Audit Passed!");
            auditPassed = true;
        } else {
            console.warn(`❌ Audit Failed: ${auditResult.issues}`);
            feedback = auditResult.issues; // Pass feedback to next loop
        }
    }

    if (!auditPassed) {
        return reply.send({
            status: "failed",
            message: "Could not satisfy audit requirements after 3 attempts."
        });
    }

    // --- PHASE 4: DEPLOY ---
    const liveUrl = await deployToDaytona(currentCode);

    return reply.send({
        status: "success",
        preview_url: liveUrl,
        audit_attempts: attempts
    });
});

// Start Server
const start = async () => {
    try {
        await server.listen({ port: 3000, host: '0.0.0.0' });
        console.log("Server listening on http://localhost:3000");
    } catch (err) {
        server.log.error(err);
        process.exit(1);
    }
};
start();