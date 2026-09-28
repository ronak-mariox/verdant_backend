import { body } from 'express-validator';

const optionalString = (field: string) => body(field).optional({ values: 'null' }).isString().trim();

/** Shared product body rules for vendor create/update and admin update. On
 * `create` the identity fields are required; on `update` everything is optional. */
export function productBodyValidators(mode: 'create' | 'update') {
  const requiredOnCreate = <T extends { optional: () => T }>(chain: T) => (mode === 'create' ? chain : chain.optional());

  return [
    requiredOnCreate(body('categoryId').isMongoId().withMessage('Select a valid category')),
    optionalString('subcategoryId'),
    requiredOnCreate(body('name').isString().trim().notEmpty().withMessage('Product name is required')),
    optionalString('description'),
    optionalString('brand'),
    optionalString('unit'),
    optionalString('sku'),
    optionalString('barcode'),
    optionalString('hsnCode'),
    optionalString('countryOfOrigin'),
    body('images').optional().isArray().withMessage('images must be an array of URLs'),
    body('images.*').isString().trim().notEmpty(),
    body('tags').optional().isArray().withMessage('tags must be an array of strings'),
    body('tags.*').isString().trim().notEmpty(),
    body('taxRate').optional({ values: 'null' }).isFloat({ min: 0, max: 100 }),
    body('reorderLevel').optional({ values: 'null' }).isInt({ min: 0 }),
    body('maxStock').optional({ values: 'null' }).isInt({ min: 0 }),
    body('isAvailable').optional().isBoolean(),
    requiredOnCreate(body('variants').isArray({ min: 1 }).withMessage('At least one variant is required')),
    body('variants.*.id').optional().isString().trim().notEmpty(),
    body('variants.*.label').isString().trim().notEmpty().withMessage('Every variant needs a label'),
    body('variants.*.mrp').isFloat({ min: 0 }).withMessage('Variant MRP must be a number ≥ 0'),
    body('variants.*.price')
      .isFloat({ min: 0 })
      .withMessage('Variant price must be a number ≥ 0')
      .custom((price, { req, path }) => {
        const index = Number(path.match(/\[(\d+)\]/)?.[1]);
        const mrp = req.body.variants?.[index]?.mrp;
        if (mrp !== undefined && Number(price) > Number(mrp)) throw new Error('Variant price cannot exceed its MRP');
        return true;
      }),
    body('variants.*.stock').isInt({ min: 0 }).withMessage('Variant stock must be an integer ≥ 0'),
    body('variants.*.sku').optional({ values: 'null' }).isString().trim(),
    body('variants.*.isPrimary').optional().isBoolean(),
  ];
}
