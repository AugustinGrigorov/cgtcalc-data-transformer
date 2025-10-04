const { parse } = require('csv-parse');
const fs = require('fs');

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

    /**
     * Parse CSV file and convert to standardized format
     * @param {string} filePath - Path to CSV file
     * @returns {Promise<Array>} Array of parsed transactions/events
     */
    async parseFile(filePath) {
        return new Promise((resolve, reject) => {
            const results = [];
            
            fs.createReadStream(filePath)
                .pipe(parse({ 
                    columns: true,
                    skip_empty_lines: true,
                    trim: true,
                    relax_column_count: true,
                    relax_quotes: true
                }))
                .on('data', (row) => {
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
        
        if (type === 'stock split') {
            return this.parseStockSplit(row);
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
        
        const date = this.formatDate(row['Timestamp']);
        const asset = row['ISIN'] || row['Ticker'];
        const amount = parseFloat(row['Quantity']) || 0;
        const price = parseFloat(row['Price per Share in Account Currency']) || 0;
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
        const date = this.formatDate(row['Dividend Pay Date'] || row['Dividend Ex Date']);
        const asset = row['ISIN'] || row['Ticker'];
        const amount = parseFloat(row['Dividend Eligible Quantity']) || 0;
        const value = parseFloat(row['Dividend Net Distribution Amount']) || 0;
        
        return {
            kind: 'DIVIDEND',
            date,
            asset,
            amount,
            value
        };
    }

    /**
     * Parse stock split events
     * @param {Object} row - CSV row
     * @returns {Object} Stock split event object
     */
    parseStockSplit(row) {
        const date = this.formatDate(row['Stock Split Pay Date'] || row['Stock Split Ex Date']);
        const asset = row['ISIN'] || row['Ticker'];
        const rateFrom = parseFloat(row['Stock Split Rate of Share Outturn From']) || 1;
        const rateTo = parseFloat(row['Stock Split Rate of Share Outturn To']) || 1;
        
        // Determine if it's a split or unsplit based on the ratio
        const multiplier = rateTo / rateFrom;
        const kind = multiplier > 1 ? 'SPLIT' : 'UNSPLIT';
        
        return {
            kind,
            date,
            asset,
            multiplier: multiplier.toFixed(2)
        };
    }

    /**
     * Parse capital return events
     * @param {Object} row - CSV row
     * @returns {Object} Capital return event object
     */
    parseCapitalReturn(row) {
        const date = this.formatDate(row['Timestamp']);
        const asset = row['ISIN'] || row['Ticker'];
        const amount = parseFloat(row['Quantity']) || 0;
        const value = parseFloat(row['Total Amount']) || 0;
        
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
     * Parse CSV and return formatted transaction strings
     * @param {string} filePath - Path to CSV file
     * @returns {Promise<Array>} Array of formatted transaction strings
     */
    async parseToFormat(filePath) {
        const transactions = await this.parseFile(filePath);
        return transactions.map(transaction => this.formatTransaction(transaction));
    }
}

module.exports = FreetradeParser;
