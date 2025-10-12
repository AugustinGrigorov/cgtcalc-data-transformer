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
            parse(content, { 
                columns: true,
                skip_empty_lines: true,
                trim: true,
                relax_column_count: true,
                relax_quotes: true,
                bom: true
            }, (err, records) => {
                if (err) return reject(err);
                for (const row of records) {
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
        // Get the actual date field (handle BOM in column names)
        const dateField = this.getDateField(row);
        const description = row['Description']?.toLowerCase() || '';
    const quantityRaw = row['Quantity'];
    // Treat missing or 'n/a' quantities as irrelevant rows
    if (!quantityRaw || String(quantityRaw).toLowerCase() === 'n/a') return null;
    const quantity = parseFloat(quantityRaw);
        const price = this.parsePrice(row['Price']);
        const debit = this.parseAmount(row['Debit']);
        const credit = this.parseAmount(row['Credit']);
        
        // Skip non-transaction entries (fees, transfers, etc.)
        if (description.includes('total monthly fee') || 
            description.includes('fee transfer') || 
            description.includes('debit card payment') || 
            description.includes('cash received') ||
            description.includes('trf from') ||
            quantity === 0) {
            return null;
        }
        
        // Validate numeric fields for relevant rows
        if (!isFinite(quantity) || Number.isNaN(quantity)) throw new Error(`Invalid Quantity: ${quantityRaw}`);

        // Handle buy transactions (positive quantity, debit amount)
        if (quantity > 0 && debit > 0) {
            return this.parseBuyTransaction(row, dateField);
        }

        // Handle sell transactions (negative quantity, credit amount)
        if (quantity < 0 && credit > 0) {
            return this.parseSellTransaction(row, dateField);
        }
        
        return null;
    }

    /**
     * Get the date field from a row, handling BOM characters in column names
     * @param {Object} row - CSV row object
     * @returns {string} Date value
     */
    getDateField(row) {
        const keys = Object.keys(row);
        // Find the key that ends with 'Date' (ignoring BOM characters)
        const dateKey = keys.find(key => key.endsWith('Date'));
        return dateKey ? row[dateKey] : '';
    }

    /**
     * Parse BUY transactions
     * @param {Object} row - CSV row
     * @param {string} dateField - Date value from the row
     * @returns {Object} Buy transaction object
     */
    parseBuyTransaction(row, dateField) {
        const date = this.formatDate(dateField);
        if (!date) throw new Error(`Invalid or missing date: ${dateField}`);

        const asset = (row['Sedol'] || row['Symbol'] || '').trim();
        if (!asset) throw new Error(`Missing asset identifier for buy on ${dateField}`);

        const qtyRaw = row['Quantity'];
        const amount = Math.abs(parseFloat(qtyRaw));
        if (!isFinite(amount) || Number.isNaN(amount) || amount === 0) throw new Error(`Invalid Quantity for BUY: ${qtyRaw}`);

        const price = this.parsePrice(row['Price']);
        if (!isFinite(price) || Number.isNaN(price) || price <= 0) throw new Error(`Invalid price for BUY: ${row['Price']}`);

        const expenses = this.calculateExpenses(row);
        
        return {
            kind: 'BUY',
            date,
            asset,
            amount,
            price,
            expenses
        };
    }

    /**
     * Parse SELL transactions
     * @param {Object} row - CSV row
     * @param {string} dateField - Date value from the row
     * @returns {Object} Sell transaction object
     */
    parseSellTransaction(row, dateField) {
        const date = this.formatDate(dateField);
        if (!date) throw new Error(`Invalid or missing date: ${dateField}`);

        const asset = (row['Sedol'] || row['Symbol'] || '').trim();
        if (!asset) throw new Error(`Missing asset identifier for sell on ${dateField}`);

        const qtyRaw = row['Quantity'];
        const amount = Math.abs(parseFloat(qtyRaw));
        if (!isFinite(amount) || Number.isNaN(amount) || amount === 0) throw new Error(`Invalid Quantity for SELL: ${qtyRaw}`);

        const price = this.parsePrice(row['Price']);
        if (!isFinite(price) || Number.isNaN(price) || price <= 0) throw new Error(`Invalid price for SELL: ${row['Price']}`);

        const expenses = this.calculateExpenses(row);
        
        return {
            kind: 'SELL',
            date,
            asset,
            amount,
            price,
            expenses
        };
    }

    /**
     * Parse price string and return numeric value
     * @param {string} priceStr - Price string (e.g., "£366.23747")
     * @returns {number} Numeric price value
     */
    parsePrice(priceStr) {
        if (!priceStr || priceStr === 'n/a') return 0;
        
        // Remove currency symbols and convert to number
        const cleanPrice = priceStr.replace(/[£$€,]/g, '');
        return parseFloat(cleanPrice) || 0;
    }

    /**
     * Parse amount string and return numeric value
     * @param {string} amountStr - Amount string (e.g., "£1,982.02")
     * @returns {number} Numeric amount value
     */
    parseAmount(amountStr) {
        if (!amountStr || amountStr === 'n/a') return 0;
        
        // Remove currency symbols and convert to number
        const cleanAmount = amountStr.replace(/[£$€,]/g, '');
        return parseFloat(cleanAmount) || 0;
    }

    /**
     * Calculate expenses for a transaction
     * @param {Object} row - CSV row
     * @returns {number} Total expenses (typically 0 for ii transactions)
     */
    calculateExpenses(row) {
        // ii transactions typically don't have separate expense fields
        // Expenses are usually included in the price
        return 0;
    }

    /**
     * Format date string to DD/MM/YYYY format
     * @param {string} dateString - Date string from CSV
     * @returns {string} Formatted date
     */
    formatDate(dateString) {
        if (!dateString) return '';
        
        try {
            // Handle DD/MM/YYYY format
            const parts = dateString.split('/');
            if (parts.length === 3) {
                const day = parts[0].padStart(2, '0');
                const month = parts[1].padStart(2, '0');
                const year = parts[2];
                return `${day}/${month}/${year}`;
            }
            return dateString;
        } catch (error) {
            return dateString; // Return original if parsing fails
        }
    }

    /**
     * Format transaction to the required output format
     * @param {Object} transaction - Parsed transaction
     * @returns {string} Formatted transaction string
     */
    formatTransaction(transaction) {
        if (transaction.kind === 'BUY' || transaction.kind === 'SELL') {
            return `${transaction.kind} ${transaction.date} ${transaction.asset} ${transaction.amount} ${transaction.price} ${transaction.expenses}`;
        }
        return '';
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
