const { parse } = require('csv-parse');

/**
 * Interactive Investor (ii) Parser
 * Converts ii CSV format to standardized transaction format
 */
class IIParser {
    constructor() {
        this.fieldMap = {
            date: 0,
            settlementDate: 1,
            symbol: 2,
            sedol: 3,
            quantity: 4,
            price: 5,
            description: 6,
            reference: 7,
            debit: 8,
            credit: 9,
            runningBalance: 10
        };
    }


    /**
     * Parse CSV content string and return parsed transactions
     * @param {string} content - CSV content as string
     * @returns {Promise<Array>} parsed transactions
     */
    async parseContent(content) {
        return new Promise((resolve, reject) => {
            const results = [];
            // strip BOM-like characters at start of file (first line) — single regex
            const sanitized = content.replace(/^[\uFEFF\u200B\u200E\u200F]+/, '');

            parse(sanitized, {
                columns: true,
                skip_empty_lines: true,
                trim: true,
                relax_column_count: true,
                relax_quotes: true,
                bom: true
            }, (err, records) => {
                if (err) return reject(err);
                for (const row of records) {
                    if (isNaN(Number(row['Quantity']))) continue;
                    const parsed = this.parseRow(row);
                    if (parsed) results.push(parsed);
                }
                resolve(results);
            });
        });
    }

    /**
     * Parse a single CSV row
     * @param {Object} row - CSV row object
     * @returns {Object|null} Parsed transaction/event or null if not applicable
     */
    parseRow(row) {
        const dateField = row['Settlement Date'];
        if (!dateField) throw new Error('Missing settlement date value');

        // Parse values directly, assume fields are present. If not, let operations throw.
        // Determine BUY/SELL strictly from Debit/Credit presence.
        const hasDebit = !isNaN(row['Debit'].replace(/[£,]/g, ''));
        const hasCredit = !isNaN(row['Credit'].replace(/[£,]/g, ''));
        let kind;
        if (hasDebit && !hasCredit) kind = 'BUY';
        else if (hasCredit && !hasDebit) kind = 'SELL';
        else throw new Error('Unable to determine BUY/SELL from Debit/Credit');

        const date = this.formatDate(dateField);
        const asset = row['Sedol'] || row['Symbol'];
        if (!asset) throw new Error('Missing asset identifier');

        const amount = Math.abs(Number(row['Quantity']));
        if (!isFinite(amount)) throw new Error(`Invalid Quantity: ${row['Quantity']}`);

        const rawPrice = row['Price'];
        if (!rawPrice) throw new Error('Missing Price');
        // Assuming pounds
        const priceClean = rawPrice.replace(/[£,]/g, '');
        const price = Number(priceClean);
        if (!isFinite(price)) throw new Error(`Invalid Price: ${rawPrice}`);

        // ii CSV does not provide explicit expenses/commission for trades
        const expenses = 0;

        return { kind, date, asset, amount, price, expenses };
    }

    /**
     * Format date string to DD/MM/YYYY format
     * @param {string} dateString - Date string from CSV
     * @returns {string} Formatted date
     */
    formatDate(dateString) {
        if (!dateString) throw new Error('Missing date');
        // Handle DD/MM/YYYY format explicitly
        const parts = dateString.split('/');
        if (parts.length === 3) {
            const day = parts[0].padStart(2, '0');
            const month = parts[1].padStart(2, '0');
            const year = parts[2];
            return `${day}/${month}/${year}`;
        }
        throw new Error(`Invalid date format: ${dateString}`);
    }

    /**
     * Format transaction to the required output format
     * @param {Object} transaction - Parsed transaction
     * @returns {string} Formatted transaction string
     */
    formatTransaction(transaction) {
        return `${transaction.kind} ${transaction.date} ${transaction.asset} ${transaction.amount} ${transaction.price} ${transaction.expenses}`;
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

module.exports = IIParser;
