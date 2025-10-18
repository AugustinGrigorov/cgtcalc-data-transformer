const { parse } = require('csv-parse');

/**
 * IMPORTANT: Omitted parsing and manual review note
 * ------------------------------------------------
 * This parser intentionally omits parsing for the following row types:
 *  - DIVIDEND
 *  - CAPITAL / CAPITAL RETURN
 *  - STOCK SPLIT / UNSPLIT
 *
 * Rationale:
 *  - DIVIDEND and CAPITAL rows are ambiguous: they may be dividends
 *    from individual stocks, distributions from income-class funds,
 *    retained distributions from accumulation-class funds (which can
 *    affect disposals), or simply bookkeeping/cash adjustments.
 *  - STOCK SPLIT rows are not consistently present or reliably formed
 *    in the provided Freetrade CSV data.
 *  - The CSV provides no reliable signal to distinguish share-class
 *    semantics (income vs accumulation) or to identify whether a row
 *    pertains to a fund versus an account-level event.
 *
 * Because of these ambiguities and the project's strict fail-fast
 * policy, dividend, capital-return and split rows must be reviewed and
 * handled manually when relevant. This parser only extracts explicit
 * BUY/SELL order rows and will ignore the omitted types.
 */

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
        if (!dateString) throw new Error('Missing Timestamp');

        const date = new Date(dateString);
        if (Number.isNaN(date.getTime())) throw new Error(`Invalid Timestamp: ${dateString}`);

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
            return `${transaction.kind} ${transaction.date} ${transaction.asset} ${transaction.amount} ${transaction.price} ${transaction.expenses}`;
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
