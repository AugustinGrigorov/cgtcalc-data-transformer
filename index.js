const FreetradeParser = require('./freetrade');
const IIParser = require('./ii');
const FidelityParser = require('./fidelity');
const GoldParser = require('./gold');
const fs = require('fs');
const path = require('path');

/**
 * Sort transactions chronologically by date
 * @param {Array} transactions - Array of transaction strings
 * @returns {Array} Sorted transaction strings
 */
function sortTransactionsChronologically(transactions) {
    return transactions.sort((a, b) => {
        // Extract date from transaction string (format: "BUY DD/MM/YYYY ...")
        const dateA = a.split(' ')[1]; // Second field is the date
        const dateB = b.split(' ')[1];
        
        if (!dateA || !dateB) return 0;
        
        // Convert DD/MM/YYYY to YYYY-MM-DD for proper sorting
        const [dayA, monthA, yearA] = dateA.split('/');
        const [dayB, monthB, yearB] = dateB.split('/');
        
        const dateObjA = new Date(`${yearA}-${monthA.padStart(2, '0')}-${dayA.padStart(2, '0')}`);
        const dateObjB = new Date(`${yearB}-${monthB.padStart(2, '0')}-${dayB.padStart(2, '0')}`);
        
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
 * - gold: Parse gold transactions from email files
 */
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length < 1) {
        console.error('Usage: node index.js <type> [filepath]');
        console.error('Types: freetrade, ii, fidelity, gold');
        console.error('Note: gold parser reads from email directory automatically');
        process.exit(1);
    }
    
    const [type, filePath] = args;
    
    // Check if file exists (skip for gold parser)
    if (type.toLowerCase() !== 'gold' && filePath && !fs.existsSync(filePath)) {
        console.error(`Error: File '${filePath}' does not exist`);
        process.exit(1);
    }
    
    try {
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
            case 'gold':
                const goldParser = new GoldParser();
                results = await goldParser.parseToFormat();
                break;
            default:
                console.error(`Error: Unknown parser type '${type}'`);
                console.error('Supported types: freetrade, ii, fidelity, gold');
                process.exit(1);
        }
        
        // Read existing transactions from data.txt
        const outputPath = 'data.txt';
        let existingTransactions = [];
        if (fs.existsSync(outputPath)) {
            const existingContent = fs.readFileSync(outputPath, 'utf8');
            existingTransactions = existingContent.trim().split('\n').filter(line => line.trim());
        }
        
        // Combine existing and new transactions
        let allTransactions = [];

        // If we're processing gold transactions, prefer the newly parsed gold
        // results and drop any existing GOLD lines from the file (they may be
        // stale placeholders or generated from a CSV without price info).
        if (type.toLowerCase() === 'gold') {
            const nonGold = existingTransactions.filter(line => {
                const parts = line.trim().split(/\s+/);
                // Expect format: KIND DATE ASSET ...
                return parts[2] && parts[2].toUpperCase() !== 'GOLD';
            });
            allTransactions = [...nonGold, ...results];
        } else {
            allTransactions = [...existingTransactions, ...results];
        }
        
        // Sort all transactions chronologically
        const sortedTransactions = sortTransactionsChronologically(allTransactions);
        
        // Write all transactions back to data.txt in chronological order
        const outputContent = sortedTransactions.join('\n') + '\n';
        fs.writeFileSync(outputPath, outputContent);
        
        console.log(`Successfully parsed ${results.length} new transactions`);
        console.log(`Total transactions: ${sortedTransactions.length} (all sorted chronologically)`);
        console.log('Sample output:');
        sortedTransactions.slice(0, 5).forEach(line => console.log(line));
        if (sortedTransactions.length > 5) {
            console.log(`... and ${sortedTransactions.length - 5} more transactions`);
        }
        
    } catch (error) {
        console.error('Error parsing file:', error.message);
        process.exit(1);
    }
}

// Run the CLI
main().catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
});