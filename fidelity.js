const { parse } = require('csv-parse');
const fs = require('fs');

/**
 * Fidelity Parser
 * Converts Fidelity CSV format to standardized transaction format
 */
class FidelityParser {
    constructor() {
        this.fieldMap = {
            orderDate: 0,
            completionDate: 1,
            transactionType: 2,
            investments: 3,
            productWrapper: 4,
            accountNumber: 5,
            sourceInvestment: 6,
            amount: 7,
            quantity: 8,
            pricePerUnit: 9,
            referenceNumber: 10,
            status: 11
        };
    }

    /**
     * Parse CSV file and convert to standardized format
     * @param {string} filePath - Path to CSV file
     * @returns {Promise<Array>} Array of parsed transactions/events
     */
    async parseFile(filePath) {
        return new Promise((resolve, reject) => {
            const results = [];
            let headerFound = false;
            
            fs.createReadStream(filePath, { encoding: 'utf8' })
                .pipe(parse({ 
                    columns: [
                        'Order date',
                        'Completion date', 
                        'Transaction type',
                        'Investments',
                        'Product Wrapper',
                        'Account Number',
                        'Source investment',
                        'Amount',
                        'Quantity',
                        'Price per unit',
                        'Reference Number',
                        'Status'
                    ],
                    skip_empty_lines: true,
                    trim: true,
                    relax_column_count: true,
                    relax_quotes: true,
                    from_line: 8  // Skip the header rows and start from the actual data
                }))
                .on('data', (row) => {
                    // Skip the header row if it exists
                    if (row['Order date'] === 'Order date') {
                        return;
                    }
                    
                    const parsed = this.parseRow(row);
                    if (parsed) {
                        results.push(parsed);
                    }
                })
                .on('end', () => {
                    resolve(results);
                })
                .on('error', (error) => {
                    reject(error);
                });
        });
    }

    /**
     * Parse a single CSV row
     * @param {Object} row - CSV row object
     * @returns {Object|null} Parsed transaction/event or null if not applicable
     */
    parseRow(row) {
        const transactionType = (row['Transaction type'] || '').toLowerCase();
        const amountRaw = row['Amount'];
        const quantityRaw = row['Quantity'];
        const investment = row['Investments'] || '';

        const parseNumberStrict = (v, fieldName) => {
            const n = parseFloat(v);
            if (!isFinite(n) || Number.isNaN(n)) {
                throw new Error(`Invalid ${fieldName}: ${v}`);
            }
            return n;
        };
        
        // Skip non-transaction entries (safe to check these before numeric validation)
        if (transactionType.includes('cash in') || 
            transactionType.includes('cash out') ||
            transactionType.includes('transfer out') ||
            transactionType.includes('transfer to cash') ||
            transactionType.includes('auto-sell for fees') ||
            transactionType.includes('cash in fees') ||
            transactionType.includes('cash out for buy') ||
            transactionType.includes('cash in from sell') ||
            investment.toLowerCase() === 'cash') {
            return null;
        }

        // For rows that are potentially relevant, validate numeric fields strictly.
        // quantityRaw and amountRaw must parse to finite numbers.
        const quantity = parseNumberStrict(quantityRaw, 'Quantity');
        const amount = parseNumberStrict(amountRaw, 'Amount');

        // If quantity is zero, treat as irrelevant and skip.
        if (quantity === 0) return null;

        // Decide BUY/SELL primarily from the sign of the quantity.
        if (quantity > 0) return this.parseBuyTransaction(row);
        if (quantity < 0) return this.parseSellTransaction(row);

        // Shouldn't get here because quantity === 0 is handled above.
        return null;
    }

    /**
     * Parse BUY transactions
     * @param {Object} row - CSV row
     * @returns {Object} Buy transaction object
     */
    parseBuyTransaction(row) {
        const dateRaw = row['Completion date'];
        const date = this.formatDate(dateRaw);
        if (!date) throw new Error(`Invalid or missing Completion date: ${dateRaw}`);

        const asset = this.getAssetIdentifier(row);
        if (!asset || asset.length === 0) throw new Error(`Invalid or missing Investments field: ${row['Investments']}`);

        const quantityRaw = row['Quantity'];
        const qty = parseFloat(quantityRaw);
        if (!isFinite(qty) || Number.isNaN(qty) || qty <= 0) {
            throw new Error(`Invalid Quantity for BUY: ${quantityRaw}`);
        }
        const amount = Math.abs(qty);

        const priceRaw = row['Price per unit'];
        const price = parseFloat(priceRaw);
        if (!isFinite(price) || Number.isNaN(price) || price <= 0) {
            throw new Error(`Invalid Price per unit for BUY: ${priceRaw}`);
        }

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
     * @returns {Object} Sell transaction object
     */
    parseSellTransaction(row) {
        const dateRaw = row['Completion date'];
        const date = this.formatDate(dateRaw);
        if (!date) throw new Error(`Invalid or missing Completion date: ${dateRaw}`);

        const asset = this.getAssetIdentifier(row);
        if (!asset || asset.length === 0) throw new Error(`Invalid or missing Investments field: ${row['Investments']}`);

        const quantityRaw = row['Quantity'];
        const qty = parseFloat(quantityRaw);
        if (!isFinite(qty) || Number.isNaN(qty) || qty >= 0) {
            throw new Error(`Invalid Quantity for SELL (expected negative): ${quantityRaw}`);
        }
        const amount = Math.abs(qty);

        const priceRaw = row['Price per unit'];
        const price = parseFloat(priceRaw);
        if (!isFinite(price) || Number.isNaN(price) || price <= 0) {
            throw new Error(`Invalid Price per unit for SELL: ${priceRaw}`);
        }

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
     * Get asset identifier from investment name
     * @param {Object} row - CSV row
     * @returns {string} Asset identifier
     */
    getAssetIdentifier(row) {
        const investment = row['Investments'] || '';
        
        // Try to extract ticker/symbol from investment name
        // Look for common patterns like "Vanguard", "iShares", etc.
        if (investment.includes('Vanguard')) {
            // Extract fund name for Vanguard funds
            const match = investment.match(/Vanguard\s+([^,]+)/);
            if (match) {
                return match[1].trim().replace(/\s+/g, '_');
            }
        }
        
        if (investment.includes('iShares')) {
            // Extract fund name for iShares funds
            const match = investment.match(/iShares\s+([^,]+)/);
            if (match) {
                return match[1].trim().replace(/\s+/g, '_');
            }
        }
        
        if (investment.includes('Baillie Gifford')) {
            // Extract fund name for Baillie Gifford funds
            const match = investment.match(/Baillie Gifford\s+([^,]+)/);
            if (match) {
                return match[1].trim().replace(/\s+/g, '_');
            }
        }
        
        // Fallback to first few words of investment name
        const words = investment.split(' ').slice(0, 3);
        return words.join('_').replace(/[^a-zA-Z0-9_]/g, '');
    }

    /**
     * Calculate expenses for a transaction
     * @param {Object} row - CSV row
     * @returns {number} Total expenses (typically 0 for Fidelity transactions)
     */
    calculateExpenses(row) {
        // Fidelity transactions typically don't have separate expense fields
        // Expenses are usually included in the price
        return 0;
    }

    /**
     * Format date string to DD/MM/YYYY format
     * @param {string} dateString - Date string from CSV (e.g., "11 Oct 2021")
     * @returns {string} Formatted date
     */
    formatDate(dateString) {
        if (!dateString) return '';
        
        try {
            // Handle "DD MMM YYYY" format (e.g., "11 Oct 2021")
            const date = new Date(dateString);
            if (isNaN(date.getTime())) {
                return dateString; // Return original if parsing fails
            }
            
            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = date.getFullYear();
            return `${day}/${month}/${year}`;
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
    async parseToFormat(filePath) {
        const transactions = await this.parseFile(filePath);
        return transactions.map(transaction => this.formatTransaction(transaction));
    }
}

module.exports = FidelityParser;
