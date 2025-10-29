const { parse } = require('csv-parse');

const supportedTransactionTypes = [
    "buy",
    "sell",
    "auto-sell for fees",
    "buy for switch",
    "sell for switch",
    "buy from regular savings plan",
    "cash out/sell for transfer"
];

const parseNumberStrict = (v, fieldName) => {
    const n = parseFloat(v);
    if (!isFinite(n) || Number.isNaN(n)) {
        throw new Error(`Invalid ${fieldName}: ${v}`);
    }
    return n;
};

/**
 * Fidelity Parser
 * Converts Fidelity CSV format to standardized transaction format
 */
class FidelityParser {
    /**
     * Parse CSV content and return parsed transactions
     * @param {string} content - CSV content as string
     * @returns {Promise<Array>} parsed transactions
     */
    async parseContent(content) {
        return new Promise((resolve, reject) => {
            parse(content, {
                columns: [
                    'Order date', 'Completion date', 'Transaction type', 'Investments', 'Product Wrapper', 'Account Number', 'Source investment', 'Amount', 'Quantity', 'Price per unit', 'Reference Number', 'Status'
                ],
                skip_empty_lines: true,
                trim: true,
                relax_column_count: true,
                relax_quotes: true,
                from_line: 9
            }, (err, records) => {
                if (err) return reject(err);
                const results = [];
                for (const row of records) {
                    if (!supportedTransactionTypes.includes(row['Transaction type'].toLowerCase())) continue;
                    results.push(this.parseTransaction(row));
                }
                resolve(results);
            });
        });
    }

    /**
     * Transaction parser.
     * @param {Object} row - CSV row
     * @returns {Object} Parsed transaction object
     */
    parseTransaction(row) {
        const amount = parseNumberStrict(row['Amount'], 'Amount');
        if (amount === 0) throw new Error(`Zero Amount is not a valid transaction`);

        const dateRaw = row['Completion date'];
        const date = this.formatDate(dateRaw);

        const asset = row['Investments'].replace(/\s+/g, '_');
        if (!asset || asset.length === 0) throw new Error(`Invalid or missing Investments field: ${row['Investments']}`);

        const quantity = parseNumberStrict(row['Quantity'], 'Quantity');
        if (quantity === 0) throw new Error(`Zero Quantity is not a valid transaction`);

        const priceRaw = row['Price per unit'];
        const price = parseFloat(priceRaw);
        if (!isFinite(price) || Number.isNaN(price) || price <= 0) {
            throw new Error(`Invalid Price per unit for ${priceRaw}`);
        }

        const expenses = 0;

        return {
            kind: amount > 0 ? 'BUY' : 'SELL',
            date,
            asset,
            quantity,
            price,
            expenses
        };
    }

    /**
     * Format date string to DD/MM/YYYY format
     * @param {string} dateString - Date string from CSV (e.g., "11 Oct 2021")
     * @returns {string} Formatted date
     */
    formatDate(dateString) {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) {
            throw new Error(`Invalid date format: ${dateString}`);
        }

        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        return `${day}/${month}/${year}`;

    }

    /**
     * Format transaction to the required output format
     * @param {Object} transaction - Parsed transaction
     * @returns {string} Formatted transaction string
     */
    formatTransaction(transaction) {
        if (transaction.kind === 'BUY' || transaction.kind === 'SELL') {
            return `${transaction.kind} ${transaction.date} ${transaction.asset} ${transaction.quantity} ${transaction.price} ${transaction.expenses}`;
        }
        throw new Error(`Unsupported transaction kind: ${transaction.kind}`);
    }

    /**
     * Parse CSV and return formatted transaction strings
     * @param {string} filePath - Path to CSV file
     * @returns {Promise<Array>} Array of formatted transaction strings
     */
    async parseToFormat(content) {
        const transactions = await this.parseContent(content);
        return transactions.map(transaction => this.formatTransaction(transaction));
    }
}

module.exports = FidelityParser;
