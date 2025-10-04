const fs = require('fs');
const path = require('path');

/**
 * Gold Email Parser
 * Extracts gold transaction data from BullionVault email files
 */
class GoldParser {
    constructor() {
        // Default to the project's `gold-transaction-emails` directory so the
        // parser will work when run from this repository.
        this.emailDirectory = path.join(__dirname, 'gold-transaction-emails');
    }

    /**
     * Parse all email files and extract transactions
     * @returns {Promise<Array>} Array of parsed transactions
     */
    async parseAllEmails() {
        const results = [];
        
        const files = fs.readdirSync(this.emailDirectory);
        const emailFiles = files.filter(file => file.endsWith('.eml'));

        console.log(`Found ${emailFiles.length} email files to process...`);

        for (const file of emailFiles) {
            const filePath = path.join(this.emailDirectory, file);
            const transaction = await this.parseEmailFile(filePath);
            if (transaction) {
                results.push(transaction);
            }
        }

        return results;
    }

    /**
     * Parse a single email file
     * @param {string} filePath - Path to email file
     * @returns {Promise<Object|null>} Parsed transaction or null
     */
    async parseEmailFile(filePath) {
        let content = fs.readFileSync(filePath, 'utf8');

            // Emails are often HTML and use quoted-printable encoding. Decode
            // common quoted-printable sequences and strip HTML so regexes see
            // the plain text.
            content = this.decodeQuotedPrintable(content);
            content = this.stripHtml(content);

            // Extract transaction details using more tolerant regex patterns
            const summaryMatch = content.match(/Summary:\s*(Buy|Sell)\s*([0-9,.]+)kg\s*@\s*GBP\s*([0-9,]+(?:\.[0-9]+)?)[\/]?kg/i);
            const considerationMatch = content.match(/Consideration:\s*GBP\s*([0-9,]+(?:\.[0-9]+)?)/i);
            const commissionMatch = content.match(/Commission:\s*GBP\s*([0-9,]+(?:\.[0-9]+)?)/i);
            const totalMatch = content.match(/(?:Total cost|Total received):\s*GBP\s*([0-9,]+(?:\.[0-9]+)?)/i);
            const dealTimeMatch = content.match(/Deal time:\s*([^\r\n]+)/i);
            
            if (!summaryMatch) {
                return null; // Not a transaction email
            }
            
            const kind = summaryMatch[1].toUpperCase();
            const quantityRaw = summaryMatch[2].replace(/,/g, '');
            const quantity = parseFloat(quantityRaw);
            const priceRaw = summaryMatch[3].replace(/,/g, '');
            const pricePerKg = parseFloat(priceRaw);
            const consideration = considerationMatch ? parseFloat(considerationMatch[1].replace(/,/g, '')) : null;
            const commission = commissionMatch ? parseFloat(commissionMatch[1].replace(/,/g, '')) : null;
            const total = totalMatch ? parseFloat(totalMatch[1].replace(/,/g, '')) : null;

            if (!isFinite(quantity) || Number.isNaN(quantity) || quantity === 0) {
                throw new Error(`Invalid quantity parsed from email ${filePath}: ${quantityRaw}`);
            }
            if (!isFinite(pricePerKg) || Number.isNaN(pricePerKg) || pricePerKg <= 0) {
                throw new Error(`Invalid price parsed from email ${filePath}: ${priceRaw}`);
            }
            
            // Extract date from the 'Deal time' line (preferred). If that
            // fails, read the raw headers and parse the 'Date:' header. If
            // neither yields a parsable date, throw — don't invent one.
            let date = null;

            if (dealTimeMatch) {
                const dtRaw = dealTimeMatch[1].trim();
                const dtPartMatch = dtRaw.match(/([A-Za-z]+\s+\d{1,2},\s*\d{4}(?:\s+at\s+[^G]+GMT)?|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/i);
                const dtForFormat = dtPartMatch ? dtPartMatch[1] : dtRaw;
                date = this.formatDate(dtForFormat.trim());
            }

            if (!date) {
                const raw = fs.readFileSync(filePath, 'utf8');
                const headerDateMatch = raw.match(/^Date:\s*(.+)$/m);
                if (headerDateMatch) {
                    date = this.formatDate(headerDateMatch[1].trim());
                }
            }

            if (!date) {
                // Fail fast — do not fabricate a date. Caller (CLI) will see
                // this exception and can handle it as needed.
                throw new Error(`No parsable date found in ${filePath}`);
            }
            
            return {
                kind,
                date,
                asset: 'GOLD',
                amount: quantity,
                price: pricePerKg,
                expenses: commission
            };

    }

    /**
     * Format date string to DD/MM/YYYY format
     * @param {string} dateString - Date string from email
     * @returns {string} Formatted date
     */
    formatDate(dateString) {
        if (!dateString || typeof dateString !== 'string') return null;
        
        try {
            // Handle various date formats from emails
            let date;
            
            // Clean up the date string
            let cleanDate = dateString.trim();
            
            // Try parsing as ISO date first
            if (cleanDate.includes('GMT') || cleanDate.includes('UTC') || cleanDate.includes('BST')) {
                date = new Date(cleanDate);
            } else {
                // Try other common formats
                date = new Date(cleanDate);
            }
            
            if (isNaN(date.getTime())) {
                // Try to extract just the date part if it's in a complex format
                const dateMatch = cleanDate.match(/(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i);
                if (dateMatch) {
                    const day = dateMatch[1];
                    const month = dateMatch[2];
                    const year = dateMatch[3];
                    const monthNum = new Date(`${month} 1, ${year}`).getMonth() + 1;
                    return `${day.padStart(2, '0')}/${monthNum.toString().padStart(2, '0')}/${year}`;
                }
                return null; // Could not parse
            }
            
            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = date.getFullYear();
            return `${day}/${month}/${year}`;
        } catch (error) {
            return null;
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
     * Parse all emails and return formatted transaction strings
     * @returns {Promise<Array>} Array of formatted transaction strings
     */
    async parseToFormat() {
        const transactions = await this.parseAllEmails();
        return transactions.map(transaction => this.formatTransaction(transaction));
    }
    /**
     * Very small quoted-printable decoder for common sequences found in these
     * emails. Handles =XX hex escapes and soft line breaks.
     */
    decodeQuotedPrintable(str) {
        if (!str || typeof str !== 'string') return str;

        // Remove soft line breaks ("=\n" or "=\r\n")
        str = str.replace(/=\r?\n/g, '');

        // Decode =XX hex codes
        try {
            str = str.replace(/=([0-9A-F]{2})/gi, (m, hex) => {
                return String.fromCharCode(parseInt(hex, 16));
            });
        } catch (e) {
            // If anything goes wrong, return the original input
            return str;
        }

        return str;
    }

    // Strip HTML tags and collapse multiple whitespace characters to single spaces
    stripHtml(html) {
        if (!html || typeof html !== 'string') return html;
        // Remove tags
        let txt = html.replace(/<[^>]*>/g, '');
        // Replace HTML entities we commonly see
        txt = txt.replace(/&nbsp;/gi, ' ');
        txt = txt.replace(/&amp;/gi, '&');
        txt = txt.replace(/&lt;/gi, '<');
        txt = txt.replace(/&gt;/gi, '>');
        // Collapse whitespace
        txt = txt.replace(/\s+/g, ' ').trim();
        return txt;
    }

}

module.exports = GoldParser;
