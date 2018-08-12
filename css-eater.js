const css = require('css');
const {Puffman} = require('./puffman');


/**
 * A simple eater that will write down null-terminated string and decode them.
 * That's not performing any compression but is useful to test the concept
 * without having to actually write compression algorithms.
 */
class StringEater {
    constructor({bitbuf}) {
        this.bitbuf = bitbuf;
    }

    /**
     * Reads all available octets until finding a null character. At this point
     * stops reading and returns the string.
     *
     * @returns {string} Decoded string
     */
    eat() {
        const data = [];
        let octet;

        while ((octet = this.bitbuf.readOctet()) !== 0) {
            data.push(octet);
        }

        return new Buffer(data).toString();
    }

    /**
     * Takes a string and encodes into into the BitBuf. It just encodes octets
     * one after the others and finishes with a null character.
     *
     * @param string {string} string to encode
     */
    dump(string) {
        this.bitbuf.writeString(string);
        this.bitbuf.writeOctet(0);
    }
}


/**
 * Gives information about the next block to come. It can either be:
 *
 * - media (a media query block)
 * - raw (a string block to be restored as-is)
 * - end (end of the file)
 *
 * That information is encoded on two bits:
 *
 * - the first bit indicates if this is an end marker
 * - the second one if 1 means media and if 0 means raw
 */
class BlockType {
    constructor({bitbuf}) {
        this.bitbuf = bitbuf;
    }

    /**
     * Reads the two bits and deduces what is the block type
     *
     * @returns {string}
     */
    eat() {
        const b1 = this.bitbuf.readBit();
        const b2 = this.bitbuf.readBit();

        if (b1) {
            return 'end';
        } else if (b2) {
            return 'media';
        } else {
            return 'raw';
        }
    }

    /**
     * Writes down the type as bits
     *
     * @param type
     */
    dump(type) {
        if (type === 'end') {
            this.bitbuf.push(1);
        } else {
            this.bitbuf.push(0);
        }

        if (type === 'media') {
            this.bitbuf.push(1);
        } else {
            this.bitbuf.push(0);
        }
    }
}


/**
 * Handles media query tokens
 */
class MediaQuery extends StringEater {}

/**
 * Handles selector tokens
 */
class Selector extends StringEater {}

/**
 * Handles property tokens.
 *
 * We're not dealing with raw strings here, but rather with Huffman-coded
 * tokens. The tree is either computed from AST (at compression time) or from
 * serialized data found as a preamble in the file (at decompression time).
 */
class Prop {
    constructor({bitbuf}) {
        this.puffman = new Puffman();
        this.bitbuf = bitbuf;
    }

    /**
     * Runs the AST to find out about tokens and their frequency of apparition.
     *
     * @param ast {object} CSS's AST
     */
    loadFromAst(ast) {
        const blocks = groupBlocks(ast);

        for (const block of blocks) {
            if (block.type === 'media') {
                for (const rule of block.rules) {
                    for (const declaration of rule.declarations) {
                        if (declaration.type !== 'declaration') {
                            continue;
                        }

                        this.puffman.see(declaration.property);
                    }

                    this.puffman.see('\e');
                }
            }
        }

        this.puffman.buildTree();
        this.puffman.buildMapToBin();
    }

    /**
     * Unserializes the tree from the preamble
     */
    loadFromPreamble() {
        this.puffman.unserialize(this.bitbuf);
    }

    /**
     * Serializes the tree into the preamble
     */
    serializePreamble() {
        this.puffman.tree.serialize(this.bitbuf);
    }

    /**
     * Uses the Puffman map to dump this token's bits into the buffer
     *
     * Please note that the buffer has to have been observed before for this
     * to work.
     *
     * @param token {string}
     */
    dump(token) {
        const bin = this.puffman.mapToBin[token];

        for (const bit of bin) {
            this.bitbuf.push(bit === '1' ? 1 : 0);
        }
    }

    /**
     * Determines the next token's content from the Puffman tree.
     *
     * @returns {string}
     */
    eat() {
        return this.puffman.findToken(() => this.bitbuf.readBit());
    }
}

/**
 * Handles value tokens
 */
class Value extends StringEater {}

/**
 * Handles raw block tokens
 */
class RawBlock extends StringEater {}


/**
 * Creates the eater instances
 *
 * @param bitbuf {BitBuf} bitbuf instance to read/write from/into
 *
 * @returns {{
 *  mediaQuery: MediaQuery,
 *  blockType: BlockType,
 *  selector: Selector,
 *  prop: Prop,
 *  value: Value,
 *  rawBlock: RawBlock
 * }}
 */
function buildEaters({bitbuf}) {
    const mediaQuery = new MediaQuery({bitbuf});
    const blockType = new BlockType({bitbuf});
    const selector = new Selector({bitbuf});
    const prop = new Prop({bitbuf});
    const value = new Value({bitbuf});
    const rawBlock = new RawBlock({bitbuf});

    return {mediaQuery, blockType, selector, prop, value, rawBlock};
}


/**
 * Groups all root rules inside blank media queries (see the doc of dump())
 *
 * @param ast
 * @returns {Array}
 */
function groupBlocks(ast) {
    const blocks = [];

    for (const rule of ast.stylesheet.rules) {
        if (rule.type === 'rule') {
            const latest = blocks[blocks.length - 1];

            if (latest && latest.type === 'media' && latest.media === '') {
                latest.rules.push(rule);
            } else {
                blocks.push({
                    type: 'media',
                    media: '',
                    rules: [rule],
                });
            }
        } else if (rule.type === 'media') {
            blocks.push(rule);
        } else {
            const contents = css.stringify({
                type: 'stylesheet',
                stylesheet: {rules: [rule]},
            }, {compress: true});

            if (contents) {
                blocks.push({
                    type: 'raw',
                    contents,
                });
            }
        }
    }

    return blocks;
}

/**
 * Dumps the AST into the BitBuf
 *
 * There is something to note in comparison to regular CSS: to simplify the
 * syntax we consider that every rule is inside a media query block. If in
 * "real" CSS the rule isn't inside a media query, then we just encode the
 * query as empty. Because if that, there is a first step in the process to
 * group together all rule blocks and avoid creating a media query for each
 * selector.
 *
 * The encoding looks like this:
 *
 * [
 *    [BlockType MediaQuery [Selector* [Prop Value]*]*]
 *    | [BlockType RawBlock]
 * ]*
 *
 * Each "loop" is terminated by reading a final code instead of the expected
 * token:
 *
 * - A "end" block type means the file is finished
 * - A "\e" selector means that we're moving into the rule set
 * - A "\e" prop means that there is no more props
 * - An empty selector list means the end of a media query block
 *
 * @param ast {object} the AST of the CSS file you're encoding
 * @param bitbuf {BitBuf} bitbuf that will get filled with compressed data
 */
function dump({ast, bitbuf}) {
    const {mediaQuery, blockType, selector, prop, value, rawBlock} =
        buildEaters({bitbuf});

    prop.loadFromAst(ast);
    prop.serializePreamble();

    const blocks = groupBlocks(ast);

    for (const block of blocks) {
        blockType.dump(block.type);

        if (block.type === 'media') {
            mediaQuery.dump(block.media);

            for (const rule of block.rules) {
                for (const s of rule.selectors) {
                    selector.dump(s);
                }

                selector.dump('\e');

                for (const declaration of rule.declarations) {
                    if (declaration.type !== 'declaration') {
                        continue;
                    }

                    prop.dump(declaration.property);
                    value.dump(declaration.value);
                }

                prop.dump('\e');
            }

            selector.dump('\e');
        } else if (block.type === 'raw') {
            rawBlock.dump(block.contents);
        }
    }

    blockType.dump('end');
}

/**
 * Restores the data encoded by dump()
 *
 * @param bitbuf {BitBuf}
 * @returns {string} decoded CSS
 */
function restore({bitbuf}) {
    const {mediaQuery, blockType, selector, prop, value, rawBlock} =
        buildEaters({bitbuf});

    prop.loadFromPreamble();

    const blocks = [];

    while (bitbuf.hasMore()) {
        const type = blockType.eat();

        if (type === 'media') {
            const media = mediaQuery.eat();
            const rules = [];

            while (true) {
                const selectors = [];
                let sel;

                while ((sel = selector.eat()) !== '\e') {
                    selectors.push(sel);
                }

                if (selectors.length === 0) {
                    break;
                }

                const props = [];
                let p;

                while ((p = prop.eat()) !== '\e') {
                    const v = value.eat();
                    props.push({p, v})
                }

                rules.push(
                    `${selectors.join(',\n')} {\n` +
                    `${props.map(({p, v}) => `  ${p}: ${v}`).join(';\n')};` +
                    `\n}`
                );
            }

            let out = '';

            if (media) {
                out += `@media ${media} {\n`;
            }

            out += rules.join('\n\n');

            if (media) {
                out += '\n}\n'
            }

            blocks.push(out);
        } else if (type === 'raw') {
            blocks.push(rawBlock.eat());
        } else {
            break;
        }
    }

    return blocks.join('\n');
}


module.exports = {
    dump,
    restore,
};
