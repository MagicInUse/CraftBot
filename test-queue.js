// Simple test script to verify queue logic
// This simulates the queue behavior without RCON dependencies

let isProcessingPublicResponse = false;
const responseQueue = [];

async function simulateDelay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendOptimizedChunks(mockRcon, chunks, isLongRequest, targetPlayer = null) {
    const DELAY = isLongRequest ? 2000 : 1000;
    const responseType = targetPlayer ? `Private to ${targetPlayer}` : "Public";
    
    console.log(`[${responseType}] Starting response with ${chunks.length} chunks`);
    
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const isFirstChunk = i === 0;
        const isLastChunk = i === chunks.length - 1;
        
        console.log(`[${responseType}] Chunk ${i + 1}: ${chunk}`);
        
        // Simulate sending delay
        if (!isLastChunk) {
            await simulateDelay(DELAY);
        }
    }
    
    console.log(`[${responseType}] Response complete`);
}

async function processQueue() {
    if (isProcessingPublicResponse || responseQueue.length === 0) {
        return;
    }
    
    isProcessingPublicResponse = true;
    const { mockRcon, chunks, isLongRequest } = responseQueue.shift();
    
    console.log(`[QUEUE] Processing next public response (${responseQueue.length} remaining in queue)`);
    
    try {
        await sendOptimizedChunks(mockRcon, chunks, isLongRequest);
    } catch (error) {
        console.error("Error processing queued response:", error);
    } finally {
        isProcessingPublicResponse = false;
        // Process next item in queue if any
        if (responseQueue.length > 0) {
            setTimeout(processQueue, 500);
        }
    }
}

// Test the queue system
async function runTest() {
    console.log("=== Testing CraftBot Queue System ===\n");
    
    const mockRcon = "fake-rcon";
    
    // Simulate multiple public requests coming in quickly
    console.log("1. Adding public response to queue...");
    responseQueue.push({ 
        mockRcon, 
        chunks: ["Public response 1 chunk 1", "Public response 1 chunk 2"], 
        isLongRequest: false 
    });
    processQueue();
    
    // Add another public request while first is processing
    setTimeout(() => {
        console.log("2. Adding another public response to queue while first is processing...");
        responseQueue.push({ 
            mockRcon, 
            chunks: ["Public response 2 chunk 1"], 
            isLongRequest: false 
        });
    }, 500);
    
    // Send a private message that should bypass queue
    setTimeout(async () => {
        console.log("3. Sending private response (bypasses queue)...");
        await sendOptimizedChunks(mockRcon, ["Private response to player"], false, "TestPlayer");
    }, 1500);
    
    // Add one more public request
    setTimeout(() => {
        console.log("4. Adding third public response to queue...");
        responseQueue.push({ 
            mockRcon, 
            chunks: ["Public response 3 chunk 1"], 
            isLongRequest: false 
        });
        processQueue();
    }, 2500);
}

runTest().catch(console.error);
