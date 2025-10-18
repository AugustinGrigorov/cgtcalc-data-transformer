const { parse } = require('csv-parse');

/**
 * Freetrade Parser
 * Converts Freetrade CSV format to standardized transaction format
 */
class FreetradeParser {
    constructor() {
        this.fieldMap = {
            title: 0,
            type: 1,
            timestamp: 2,
            accountCurrency: 3,
            totalAmount: 4,
            buySell: 5,
            ticker: 6,
            isin: 7,
            pricePerShare: 8,
            stampDuty: 9,
            quantity: 10,
            venue: 11,
            orderId: 12,
            orderType: 13,
            instrumentCurrency: 14,
            totalSharesAmount: 15,
            pricePerShareInstrument: 16,
            fxRate: 17,
            baseFxRate: 18,
            fxFeeBps: 19,
            fxFeeAmount: 20,
            dividendExDate: 21,
            dividendPayDate: 22,
            dividendEligibleQuantity: 23,
            dividendAmountPerShare: 24,
            dividendGrossDistributionAmount: 25,
            dividendNetDistributionAmount: 26,
            dividendWithheldTaxPercentage: 27,
            dividendWithheldTaxAmount: 28,
            stockSplitExDate: 29,
            stockSplitPayDate: 30,
            stockSplitNewIsin: 31,
            stockSplitRateFrom: 32,
            stockSplitRateTo: 33,
            stockSplitMaintainHolding: 34,
            stockSplitNewShareQuantity: 35,
            stockSplitCashOutturnAmount: 36,
            stockSplitCashOutturnCurrency: 37,
            stockSplitCashReceivedAmount: 38,
            stockSplitHasFractionalPayout: 39,
            stockSplitFractionalPayoutAmount: 40,
            stockSplitFractionalPayoutCurrency: 41,
            stockSplitFractionalPayoutReceivedAmount: 42,
            stockSplitFractionalPayoutReceivedCurrency: 43
        };
    }

    // IMPORTANT: Stock split parsing intentionally omitted
    // --------------------------------------------------
    // Fact: stock-split rows are missing from the provided
    // Freetrade CSV data. There are no explicit, reliably-
    // formed stock-split event rows to parse. Per the project's
    // strict fail-fast policy we will not attempt heuristic
    // extraction. If explicit split rows are later provided,
    // the parsing method can be reintroduced.

    /**
     * Parse CSV content string and convert to parsed transactions
     * @param {string} content - CSV file content as string
     * @returns {Promise<Array>} Array of parsed transaction objects
     */
    async parseContent(content) {
        return new Promise((resolve, reject) => {
            const results = [];
            parse(content, { 
                columns: true,
                skip_empty_lines: true,
                trim: true,
                relax_column_count: true,
                relax_quotes: true
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
        const type = row['Type']?.toLowerCase();
        const buySell = row['Buy / Sell']?.toLowerCase();
        
        // Handle transactions (BUY/SELL) - ORDER type with Buy/Sell field
        if (type === 'order' && (buySell === 'buy' || buySell === 'sell')) {
            return this.parseTransaction(row);
        }
        
        // Handle asset events
        if (type === 'dividend' || type === 'special_dividend') {
            return this.parseDividend(row);
        }
        
        if (type === 'capital' || type === 'capital return') {
            return this.parseCapitalReturn(row);
        }
        
        return null;
    }

    /**
     * Parse BUY/SELL transactions
     * @param {Object} row - CSV row
     * @returns {Object} Transaction object
     */
    parseTransaction(row) {
        const buySell = row['Buy / Sell']?.toLowerCase();
        const kind = buySell === 'buy' ? 'BUY' : 'SELL';
        const dateRaw = row['Timestamp'];
        const date = this.formatDate(dateRaw);
        if (!date) throw new Error(`Invalid or missing Timestamp: ${dateRaw}`);

        const asset = (row['ISIN'] || row['Ticker'] || '').trim();
        if (!asset) throw new Error(`Missing asset identifier (ISIN/Ticker) for transaction on ${dateRaw}`);

        const qtyRaw = row['Quantity'];
        const amount = parseFloat(qtyRaw);
        if (!isFinite(amount) || Number.isNaN(amount) || amount === 0) {
            throw new Error(`Invalid Quantity: ${qtyRaw}`);
        }

        const priceRaw = row['Price per Share in Account Currency'];
        const price = parseFloat(priceRaw);
        if (!isFinite(price) || Number.isNaN(price) || price <= 0) {
            throw new Error(`Invalid Price per Share: ${priceRaw}`);
        }

        const expenses = this.calculateExpenses(row);
        
        return {
            kind,
            date,
            asset,
            amount,
            price,
            expenses
        };
    }

    /**
     * Parse dividend events
     * @param {Object} row - CSV row
     * @returns {Object} Dividend event object
     */
    parseDividend(row) {
        const dateRaw = row['Dividend Pay Date'] || row['Dividend Ex Date'];
        const date = this.formatDate(dateRaw);
        if (!date) throw new Error(`Invalid or missing dividend date: ${dateRaw}`);

        const asset = (row['ISIN'] || row['Ticker'] || '').trim();
        if (!asset) throw new Error(`Missing asset identifier for dividend on ${dateRaw}`);

    const amountRaw = row['Dividend Eligible Quantity'];
    const valueRaw = row['Dividend Net Distribution Amount'];

    // If either critical dividend field is missing/empty, skip the row as
    // it's not relevant for CGT (could be a reporting placeholder).
    if (!amountRaw || !valueRaw) return null;

    const amount = parseFloat(amountRaw);
    if (!isFinite(amount) || Number.isNaN(amount) || amount === 0) return null;

    const value = parseFloat(valueRaw);
    if (!isFinite(value) || Number.isNaN(value)) return null;
        
        return {
            kind: 'DIVIDEND',
            date,
            asset,
            amount,
            value
        };
    }

    /**
     * Parse capital return events
     * @param {Object} row - CSV row
     * @returns {Object} Capital return event object
     */
    parseCapitalReturn(row) {
        const dateRaw = row['Timestamp'];
        const date = this.formatDate(dateRaw);
        if (!date) throw new Error(`Invalid or missing Timestamp for capital return: ${dateRaw}`);

        const asset = (row['ISIN'] || row['Ticker'] || '').trim();
        if (!asset) throw new Error(`Missing asset identifier for capital return on ${dateRaw}`);

        const amountRaw = row['Quantity'];
        const amount = parseFloat(amountRaw);
        if (!isFinite(amount) || Number.isNaN(amount)) throw new Error(`Invalid Quantity for capital return: ${amountRaw}`);

        const valueRaw = row['Total Amount'];
        const value = parseFloat(valueRaw);
        if (!isFinite(value) || Number.isNaN(value)) throw new Error(`Invalid Total Amount for capital return: ${valueRaw}`);
        
        return {
            kind: 'CAPRETURN',
            date,
            asset,
            amount,
            value
        };
    }

    /**
     * Calculate total expenses for a transaction
     * @param {Object} row - CSV row
     * @returns {number} Total expenses
     */
    calculateExpenses(row) {
        const stampDuty = parseFloat(row['Stamp Duty']) || 0;
        const fxFee = parseFloat(row['FX Fee Amount']) || 0;
        return stampDuty + fxFee;
    }

    /**
     * Format date string to DD/MM/YYYY format
     * @param {string} dateString - Date string from CSV
     * @returns {string} Formatted date
     */
    formatDate(dateString) {
        if (!dateString) return '';
        
        try {
            const date = new Date(dateString);
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
        } else if (transaction.kind === 'DIVIDEND' || transaction.kind === 'CAPRETURN') {
            return `${transaction.kind} ${transaction.date} ${transaction.asset} ${transaction.amount} ${transaction.value}`;
        } else if (transaction.kind === 'SPLIT' || transaction.kind === 'UNSPLIT') {
            return `${transaction.kind} ${transaction.date} ${transaction.asset} ${transaction.multiplier}`;
        }
        return '';
    }

    /**
     * Parse CSV content and return formatted transaction strings
     * @param {string} content - CSV content as a string
     * @returns {Promise<Array<string>>} Array of formatted transaction strings
     */
    async parseToFormat(content) {
        // content is a CSV string
        const transactions = await this.parseContent(content);
        return transactions.map(transaction => this.formatTransaction(transaction)).filter(Boolean);
    }
}

module.exports = FreetradeParser;
