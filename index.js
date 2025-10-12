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
    
    // Validate inputs. For most parsers we expect a file path; for bullionvault we expect
    // a folder containing one or more .eml files. Fail fast if the path doesn't meet expectations.
    const lowerType = type.toLowerCase();
    if (lowerType === 'bullionvault') {
        if (!filePath) {
            throw new Error('bullionvault parser requires a folder path as the second argument');
        }
        if (!fs.existsSync(filePath) || !fs.lstatSync(filePath).isDirectory()) {
            throw new Error(`Folder '${filePath}' does not exist or is not a directory`);
        }
        // Ensure there is at least one .eml file in the folder
        const files = fs.readdirSync(filePath).filter(f => f.toLowerCase().endsWith('.eml'));
        if (!files || files.length === 0) {
            throw new Error(`Folder '${filePath}' does not contain any .eml files`);
        }
    } else {
        // For non-bullionvault parsers, require a file path that exists
        if (filePath && !fs.existsSync(filePath)) {
            throw new Error(`File '${filePath}' does not exist`);
        }
    }
    
    let results = [];

    switch (type.toLowerCase()) {
        case 'freetrade':
            const freetradeParser = new FreetradeParser();
            const freetradeContent = fs.readFileSync(filePath, 'utf8');
            results = await freetradeParser.parseToFormat(freetradeContent);
            break;
        case 'ii':
            const iiParser = new IIParser();
            const iiContent = fs.readFileSync(filePath, 'utf8');
            results = await iiParser.parseToFormat(iiContent);
            break;
        case 'fidelity':
            const fidelityParser = new FidelityParser();
            const fidelityContent = fs.readFileSync(filePath, 'utf8');
            results = await fidelityParser.parseToFormat(fidelityContent);
            break;
        case 'bullionvault':
            const bullionParser = new BullionVaultParser();
            // Read all .eml files into an array of raw strings and pass to parser
            const emlFiles = fs.readdirSync(filePath).filter(f => f.toLowerCase().endsWith('.eml'));
            const emlContents = emlFiles.map(f => fs.readFileSync(require('path').join(filePath, f), 'utf8'));
            const parsedObjs = await bullionParser.parseContent(emlContents);
            results = parsedObjs.map(tx => bullionParser.formatTransaction(tx));
            break;
        default:
            throw new Error(`Unknown parser type '${type}'. Supported types: freetrade, ii, fidelity, bullionvault`);
    }

    // Read existing transactions from data.txt and merge directly into a Set of trimmed strings.
    const outputPath = 'data.txt';
    // Build arrays of existing and incoming trimmed lines, then construct a Set for exact deduplication
    const existingArr = fs.existsSync(outputPath)
        ? fs.readFileSync(outputPath, 'utf8').split('\n').map(s => s && s.trim()).filter(Boolean)
        : [];

    // Use parser results directly (assumed to be an array of clean strings)
    const seen = new Set([...existingArr, ...results]);
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