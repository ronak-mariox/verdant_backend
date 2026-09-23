import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as ctrl from '../controllers/customerCatalogController';

export const customerCatalogRouter = Router();
customerCatalogRouter.use(authenticate, authorize('customer'));

customerCatalogRouter.get('/home', asyncHandler(ctrl.getHome));
customerCatalogRouter.get('/categories', asyncHandler(ctrl.getCategories));
customerCatalogRouter.get('/products/search', asyncHandler(ctrl.search));
customerCatalogRouter.get('/products/:id', asyncHandler(ctrl.getProduct));
customerCatalogRouter.get('/products', asyncHandler(ctrl.listProducts));
