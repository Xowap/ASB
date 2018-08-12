const {items} = require('./utils');


const NULL_NODE = 0;
const NULL_TOKEN = 0x01;
const SPLIT = 0x03;


/**
 * Represents a node in the huffman tree.
 *
 * Each node has a left and right child, this is a binary tree. The goal is
 * to statistically have as few hops as possible to reach your destination
 * (well, see how a Huffman tree works).
 *
 * Only the leave nodes will have a non-null token.
 *
 * Each node also has a counter of occurrences, as it used to balance the tree.
 */
class Node {
    constructor({token = null, occurrences = 0} = {}) {
        this.left = null;
        this.right = null;
        this.token = token;
        this.occurrences = occurrences;
    }

    /**
     * Serializes the tree simply by printing the node itself, its left node's
     * serialization and right node's serialization in order, recursively. The
     * recursion is stopped by a NULL_NODE code. Also each part of the array
     * is separated by the SPLIT character.
     *
     * @param bitbuf {BitBuf} serialization goes into this
     */
    serialize(bitbuf) {
        const buildString = (node) => {
            if (node === null) {
                bitbuf.writeOctet(NULL_NODE);
                bitbuf.writeOctet(SPLIT);
            } else {
                if (node.token === null) {
                    bitbuf.writeOctet(NULL_TOKEN);
                } else {
                    bitbuf.writeString(node.token);
                }
                bitbuf.writeOctet(SPLIT);

                buildString(node.left);
                buildString(node.right);
            }
        };

        buildString(this);
    }

    /**
     * Takes a bitbuf filled by a Node's serialize() and decodes it. It returns
     * a Node that is the root of the subsequent tree.
     *
     * @param bitbuf {BitBuf} Reads content from there
     * @returns {Node}
     */
    static unserialize(bitbuf) {
        function buildTree() {
            const val = bitbuf.readString(SPLIT);

            if (val.charCodeAt(0) === NULL_NODE) {
                return null;
            } else {
                const node = new Node();

                if (val.charCodeAt(0) !== NULL_TOKEN) {
                    node.token = val;
                }

                node.left = buildTree();
                node.right = buildTree();

                return node;
            }
        }

        return buildTree();
    }
}


/**
 * A helper class to help encode and decode a Huffman code.
 */
class Puffman {
    constructor() {
        this.tokenOccurrences = {};
        this.tree = null;
        this.mapToBin = {};
    }

    /**
     * Observe the given token to increase its number of occurrences.
     * Non-observed tokens won't be in the tree and trying to encode them will
     * fail.
     *
     * @param token {string} a token to observe
     */
    see(token) {
        if (this.tokenOccurrences[token] === undefined) {
            this.tokenOccurrences[token] = 0;
        }

        this.tokenOccurrences[token] += 1;
    }

    /**
     * Given the observed tokens, builds the Huffman tree.
     */
    buildTree() {
        const base = [];

        function sort() {
            base.sort((a, b) => {
                return b.occurrences - a.occurrences;
            });
        }

        for (const [token, occurrences] of items(this.tokenOccurrences)) {
            base.push(new Node({token, occurrences}))
        }

        while (base.length > 1) {
            sort();

            const n = new Node();

            n.left = base.pop();
            n.occurrences += n.left.occurrences;

            n.right = base.pop();
            n.occurrences += n.right.occurrences;

            base.push(n);
        }

        this.tree = base[0];
    }

    /**
     * Given the existing tree, computes the translation map from tokens to
     * their binary representation.
     */
    buildMapToBin() {
        const walk = (node, prefix = '') => {
            if (node.token !== null) {
                this.mapToBin[node.token] = prefix;
            } else {
                walk(node.left, `${prefix}0`);
                walk(node.right, `${prefix}1`);
            }
        };

        walk(this.tree);
    }

    /**
     * Reads an input bit-by-bit to find the coming token. The `next` argument
     * is a callback which will return the next bit as a number.
     *
     * Once all the bits for the current token are consumed, the token is
     * returned as a string.
     *
     * @param next {function} Function that will return the next bit until done
     * @returns {string} The found token
     */
    findToken(next) {
        let node = this.tree;

        while (true) {
            let dir = next();

            if (dir) {
                node = node.right;
            } else {
                node = node.left;
            }

            if (node.token !== null) {
                return node.token;
            }
        }
    }

    /**
     * Given a bitbuf, extracts the data from it to re-build the tree.
     *
     * @param bitbuf
     */
    unserialize(bitbuf) {
        this.tree = Node.unserialize(bitbuf);
    }
}


module.exports = {
    Puffman,
};
