'use strict';
// Validator for the types/enum/required/items/additionalProperties subset used
// by the project's fixed schema. No model response is normalized into validity.
function validate(value, schema, at = '$') {
  const errors = []; const types = [].concat(schema.type || []);
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (types.length && !types.includes(type)) return [`${at}: invalid type`];
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at}: invalid enum`);
  if (type === 'object') {
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) errors.push(`${at}.${key}: required`);
    for (const key of Object.keys(value)) {
      if (schema.properties && Object.hasOwn(schema.properties, key)) errors.push(...validate(value[key], schema.properties[key], `${at}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${at}.${key}: unknown field`);
    }
  }
  if (type === 'array' && schema.items) value.forEach((item, i) => errors.push(...validate(item, schema.items, `${at}[${i}]`)));
  return errors;
}
module.exports = { validate };
