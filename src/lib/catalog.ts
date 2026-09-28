import { Category } from '../models/Category';
import { HttpError } from './httpError';

/** 422s unless the category (and, when given, its subcategory) exists and is active. */
export async function assertCategoryAssignable(categoryId: string, subcategoryId?: string | null): Promise<void> {
  const category = await Category.findById(categoryId);
  if (!category || !category.isActive) {
    throw new HttpError(422, 'Validation failed', [{ path: 'categoryId', msg: 'Select a valid, active category' }]);
  }
  if (subcategoryId) {
    const sub = category.subcategories.find((s) => s.id === subcategoryId);
    if (!sub || !sub.isActive) {
      throw new HttpError(422, 'Validation failed', [{ path: 'subcategoryId', msg: 'Select a valid, active subcategory of this category' }]);
    }
  }
}
