const fs = require('fs');
const path = require('path');

/**
 * BullionVault Email Parser
 * Extracts gold transaction data from BullionVault email files
 */
class BullionVaultParser {
    constructor(emailDirectory) {
        if (!emailDirectory) {
            throw new Error('BullionVaultParser requires an valid email directory');
        }
        this.emailDirectory = emailDirectory;
    }

    async parseAllEmails() {
        const results = [];
        const dir = this.emailDirectory;
        const files = fs.readdirSync(dir);
        const emailFiles = files.filter(file => file.endsWith('.eml'));

        console.log(`Found ${emailFiles.length} email files to process in ${dir}...`);

        for (const file of emailFiles) {
            const filePath = path.join(dir, file);
            const transaction = await this.parseEmailFile(filePath);
            if (transaction) {
                results.push(transaction);
            }
        }

        return results;
    }

    async parseEmailFile(filePath) {
        let content = fs.readFileSync(filePath, 'utf8');

            content = this.decodeQuotedPrintable(content);
            content = this.stripHtml(content);

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

    formatDate(dateString) {
        if (!dateString || typeof dateString !== 'string') return null;
        
        try {
            let date;
            let cleanDate = dateString.trim();
            if (cleanDate.includes('GMT') || cleanDate.includes('UTC') || cleanDate.includes('BST')) {
                date = new Date(cleanDate);
            } else {
                date = new Date(cleanDate);
            }
            
            if (isNaN(date.getTime())) {
                const dateMatch = cleanDate.match(/(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i);
                if (dateMatch) {
                    const day = dateMatch[1];
                    const month = dateMatch[2];
                    const year = dateMatch[3];
                    const monthNum = new Date(`${month} 1, ${year}`).getMonth() + 1;
                    return `${day.padStart(2, '0')}/${monthNum.toString().padStart(2, '0')}/${year}`;
                }
                return null;
            }
            
            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = date.getFullYear();
            return `${day}/${month}/${year}`;
        } catch (error) {
            return null;
        }
    }

    formatTransaction(transaction) {
        if (transaction.kind === 'BUY' || transaction.kind === 'SELL') {
            return `${transaction.kind} ${transaction.date} ${transaction.asset} ${transaction.amount} ${transaction.price} ${transaction.expenses}`;
        }
        return '';
    }

    async parseToFormat() {
        const transactions = await this.parseAllEmails();
        return transactions.map(transaction => this.formatTransaction(transaction));
    }

    decodeQuotedPrintable(str) {
        if (!str || typeof str !== 'string') return str;

        str = str.replace(/=\r?\n/g, '');

        try {
            str = str.replace(/=([0-9A-F]{2})/gi, (m, hex) => {
                return String.fromCharCode(parseInt(hex, 16));
            });
        } catch (e) {
            return str;
        }

        return str;
    }

    stripHtml(html) {
        if (!html || typeof html !== 'string') return html;
        let txt = html.replace(/<[^>]*>/g, '');
        txt = txt.replace(/&nbsp;/gi, ' ');
        txt = txt.replace(/&amp;/gi, '&');
        txt = txt.replace(/&lt;/gi, '<');
        txt = txt.replace(/&gt;/gi, '>');
        txt = txt.replace(/\s+/g, ' ').trim();
        return txt;
    }

}

module.exports = BullionVaultParser;
