const FreetradeParser = require('./freetrade');
const IIParser = require('./ii');
const FidelityParser = require('./fidelity');
const BullionVaultParser = require('./bullionvault');
const fs = require('fs');
/**
 * Sort transactions chronologically by date
 * @param {Array} transactions - Array of transaction strings
 * @returns {Array} Sorted transaction strings
 */
function sortTransactionsChronologically(transactions) {
    return transactions.sort((a, b) => {
        // Extract date from transaction string (format: "BUY DD/MM/YYYY ...")
        const dateA = (a || '').split(' ')[1]; // Second field is the date
        const dateB = (b || '').split(' ')[1];

        // If any line is missing a date, fail fast — this is unrecoverable per user policy.
        if (!dateA || !dateB) {
            throw new Error(`Missing or unparseable date in transaction line. Line A: '${a}', Line B: '${b}'`);
        }

        const [dayA, monthA, yearA] = dateA.split('/').map(s => parseInt(s, 10));
        const [dayB, monthB, yearB] = dateB.split('/').map(s => parseInt(s, 10));

        if (!yearA || !monthA || !dayA || !yearB || !monthB || !dayB) {
            throw new Error(`Unparsable date in transaction line. Line A: '${a}', Line B: '${b}'`);
        }

        // Use numeric Date constructor (year, monthIndex, day) — avoids string parsing issues
        const dateObjA = new Date(yearA, monthA - 1, dayA);
        const dateObjB = new Date(yearB, monthB - 1, dayB);

        return dateObjA - dateObjB;
    });
}

/**
 * CLI for parsing financial transaction data
 * Usage: node index.js <type> <filepath>
 * 
 * Types:
 * - freetrade: Parse Freetrade CSV format
 * - ii: Parse Interactive Investor CSV format
 * - fidelity: Parse Fidelity CSV format
 * - bullionvault: Parse BullionVault "Dealing advice" email files
 */
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length < 1) { 
        throw new Error('Usage: node index.js <type> [filepath]\nTypes: freetrade, ii, fidelity, bullionvault\nNote: bullionvault parser reads from a folder of email files and requires a folder path');
    }
    
    const [type, filePath] = args;
    
    // Check if file exists (skip for bullionvault parser)
    if (type.toLowerCase() !== 'bullionvault' && filePath && !fs.existsSync(filePath)) { 
        throw new Error(`File '${filePath}' does not exist`);
    }
    
    let results = [];

    switch (type.toLowerCase()) {
        case 'freetrade':
            const freetradeParser = new FreetradeParser();
            results = await freetradeParser.parseToFormat(filePath);
            break;
        case 'ii':
            const iiParser = new IIParser();
            results = await iiParser.parseToFormat(filePath);
            break;
        case 'fidelity':
            const fidelityParser = new FidelityParser();
            results = await fidelityParser.parseToFormat(filePath);
            break;
        case 'bullionvault':
            if (!filePath) {
                throw new Error('bullionvault parser requires a folder path as the second argument');
            }
            if (!fs.existsSync(filePath) || !fs.lstatSync(filePath).isDirectory()) {
                throw new Error(`Folder '${filePath}' does not exist or is not a directory`);
            }
            const bullionParser = new BullionVaultParser(filePath);
            results = await bullionParser.parseToFormat();
            break;
        default:
            throw new Error(`Unknown parser type '${type}'. Supported types: freetrade, ii, fidelity, bullionvault`);
    }

    // Read existing transactions from data.txt
    const outputPath = 'data.txt';
    let existingTransactions = [];
    if (fs.existsSync(outputPath)) {
        const existingContent = fs.readFileSync(outputPath, 'utf8');
        existingTransactions = existingContent.trim().split('\n').filter(line => line.trim());
    }

    // Merge existing and new transactions using a Set of trimmed strings.
    const seen = new Set();

    for (const line of existingTransactions) {
        if (!line || typeof line !== 'string') continue;
        seen.add(line.trim());
    }

    for (const line of results) {
        if (!line || typeof line !== 'string') continue;
        seen.add(line.trim());
    }

    const merged = Array.from(seen);

    // Sort merged transactions chronologically
    const sortedTransactions = sortTransactionsChronologically(merged);

    // Write all transactions back to data.txt in chronological order
    const outputContent = sortedTransactions.join('\n') + '\n';
    fs.writeFileSync(outputPath, outputContent, 'utf8');

    console.log(`Successfully parsed ${results.length} new transactions`);
    console.log(`Total transactions: ${sortedTransactions.length} (all sorted chronologically)`);
    console.log('Sample output:');
    sortedTransactions.slice(0, 5).forEach(line => console.log(line));
    if (sortedTransactions.length > 5) {
        console.log(`... and ${sortedTransactions.length - 5} more transactions`);
    }
}

// Run the CLI
main();