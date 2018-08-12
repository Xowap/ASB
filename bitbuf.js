const CHUNK_SIZE = 1024;
const OCTET_SIZE = 8;


/**
 * The BitBuf is an abstraction over arrays to provide an easy way to read and
 * write bits directly without having to resort to bitwise operations.
 */
class BitBuf {
    constructor() {
        this.chunks = [];
        this.length = 0;
        this.pos = 0;
    }

    /**
     * Internal method to get the coordinates of a given index:
     *
     * - Data is stored in fixed-size chunks, which are uint8 arrays. This is
     *   the chunkIndex, indicating which chunk of this.chunks needs to be
     *   consulted
     * - Obviously, those chunks are composed of octets. Each octet have 8 bits
     *   (no shit) and the octetIndex indicates at which octet to look at
     * - And finally since those octet are made of bits, we'll pick the bit
     *   using bitIndex
     *
     * @param index {number} bit index to look for
     * @returns {{chunkIndex: number, octetIndex: number, bitIndex: number}}
     */
    static getCoordinates(index) {
        const chunkIndex = Math.floor(index / (CHUNK_SIZE * OCTET_SIZE));
        const octetIndex =
            Math.floor(index / OCTET_SIZE) - chunkIndex * CHUNK_SIZE;
        const bitIndex = index - (
            chunkIndex * CHUNK_SIZE * OCTET_SIZE
            + octetIndex * OCTET_SIZE
        );

        return {chunkIndex, octetIndex, bitIndex};
    }

    /**
     * Gets the chunk at given index. If the chunk doesn't exist, it will be
     * created just like all the chunks to reach it.
     *
     * @param index {number} chunk index to get or create
     * @returns {Uint8Array}
     */
    getChunk(index) {
        for (let i = this.chunks.length; i <= index; i += 1) {
            this.chunks.push(new Uint8Array(CHUNK_SIZE));
        }

        return this.chunks[index];
    }

    /**
     * Pushes a bit (0 or 1) at the end of the buffer.
     *
     * @param bit {number} the bit has to be 0 or 1
     */
    push(bit) {
        const {chunkIndex, octetIndex, bitIndex} =
            BitBuf.getCoordinates(this.length);
        const chunk = this.getChunk(chunkIndex);

        chunk[octetIndex] |= (bit & 1) << bitIndex;

        this.length += 1;
    }

    /**
     * Gets the bit at given index
     *
     * @param index {number} bit index
     * @returns {number} output bit
     */
    get(index) {
        if ((index + 1) > this.length) {
            throw new Error(`Index error: ${index} is outside the buffer`);
        }

        const {chunkIndex, octetIndex, bitIndex} =
            BitBuf.getCoordinates(index);
        const chunk = this.getChunk(chunkIndex);

        return (chunk[octetIndex] >> bitIndex) & 1;
    }

    /**
     * Encodes a full octet and pushes it into the buffer
     *
     * @param octet {number} an integer from 0 to 255
     */
    writeOctet(octet) {
        for (let i = 0; i < OCTET_SIZE; i += 1) {
            this.push(octet >> i)
        }
    }

    /**
     * Decodes a full octet from the buffer and advances the reading position.
     *
     * @returns {number} the octet that was read
     */
    readOctet() {
        let octet = 0;

        for (let i = 0; i < OCTET_SIZE; i += 1) {
            octet |= this.get(this.pos + i) << i;
        }

        this.pos += OCTET_SIZE;

        return octet;
    }

    /**
     * Reads one bit and advances the reading position.
     *
     * @returns {number} one bit
     */
    readBit() {
        const octet = this.get(this.pos);
        this.pos += 1;
        return octet;
    }

    /**
     * Returns true until the reading position reaches the end of the buffer
     *
     * @returns {boolean}
     */
    hasMore() {
        return this.pos < this.length;
    }

    /**
     * Converts this bit buffer to an actual buffer
     *
     * @returns {Buffer}
     */
    toBuffer() {
        return Buffer.concat(this.chunks, Math.ceil(this.length / OCTET_SIZE));
    }

    /**
     * Grows this instance from a standard buffer. Please note that buffers
     * length, in terms of bits, is a multiple of 8. If your initial data was
     * not a multiple of 8 then you're going to see some extra useless padding
     * at the end.
     *
     * @param buf
     */
    fromBuffer(buf) {
        for (let i = 0; i < buf.length; i += CHUNK_SIZE) {
            this.chunks.push(buf.slice(i, i + CHUNK_SIZE));
        }

        this.length = buf.length * OCTET_SIZE;
    }
}


module.exports = {
    BitBuf,
};
