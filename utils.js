/**
 * Utility function to iterate over key/values of an object
 *
 * @param obj {object} Object to be iterated
 */
function * items(obj) {
    for (const key of Object.keys(obj)) {
        yield [key, obj[key]];
    }
}


module.exports = {
    items,
};
