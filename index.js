const css = require('css');
const fse = require('fs-extra');
const {ArgumentParser} = require('argparse');
const {BitBuf} = require('./bitbuf');
const {dump, restore} = require('./css-eater');


/**
 * Does the argument parsing
 */
function parseArgs() {
    const parser = new ArgumentParser({
        addHelp: true,
        version: '0.1.0',
        description: 'A tool to compress/decompress CSS files using the ASB ' +
            'technique'
    });

    parser.addArgument(
        ['-i', '--input'],
        {
            help: 'Input file',
            required: true,
        }
    );

    parser.addArgument(
        ['-o', '--output'],
        {
            help: 'Output file',
            required: true,
        }
    );

    parser.addArgument(
        ['-m', '--mode'],
        {
            help: 'Operation mode (compress or decompress)',
            required: true,
        }
    );

    return parser.parseArgs();
}


/**
 * Compression process. It parses an compresses the input file and then writes
 * the results to the output.
 *
 * @param input {string} input original file path
 * @param output {string} output compressed file path
 * @returns {Promise<void>}
 */
async function compress({input, output}) {
    const content = await fse.readFile(input, {encoding: 'utf-8'});
    const ast = css.parse(content);
    const bitbuf = new BitBuf();

    dump({ast, bitbuf});

    await fse.writeFile(output, bitbuf.toBuffer());
}

/**
 * Decompression process. It reads data from the input file and then
 * re-composes a valid CSS file into the output.
 *
 * Please note that the decompressed file will not be identical to the
 * compressed one, it will simply produce the same AST.
 *
 * @param input {string} input compressed file path
 * @param output {string} output decompressed file path
 * @returns {Promise<void>}
 */
async function decompress({input, output}) {
    const content = await fse.readFile(input);
    const bitbuf = new BitBuf();

    bitbuf.fromBuffer(content);

    const out = restore({bitbuf});
    await fse.writeFile(output, out, {encoding: 'utf-8'});
}


/**
 * Calls the functions that need to be to make this wokr
 *
 * @returns {Promise<void>}
 */
async function main() {
    const args = parseArgs();

    if (args.mode === 'compress') {
        await compress(args);
    } else if (args.mode === 'decompress') {
        await decompress(args);
    } else {
        throw new Error(`Operation mode "${args.mode}" does not exist`);
    }
}


if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((e) => {
            console.error(e);
            process.exit(1);
        });
}
