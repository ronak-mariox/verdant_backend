import bcrypt from 'bcryptjs';
import { connectDb, mongoose } from '../src/lib/db';
import { ensureDefaultAdmin } from '../src/lib/seedAdmin';
import { Vendor } from '../src/models/Vendor';
import { Category } from '../src/models/Category';
import { Product } from '../src/models/Product';
import { Review } from '../src/models/Review';
import { Coupon } from '../src/models/Coupon';
import type { CategoryVariantConfig } from '../src/models/Category';

declare const process: {
  exitCode?: number;
};

const WEIGHT_VOLUME_VARIANT_CONFIG: CategoryVariantConfig = {
  kind: 'weight_volume',
  label: 'Weight/Volume',
  units: ['g', 'kg', 'ml', 'L', 'pcs'],
};

const ELECTRONICS_VARIANT_CONFIG: CategoryVariantConfig = {
  kind: 'attribute',
  label: 'Storage',
  options: ['32GB', '64GB', '128GB', '256GB', '512GB', '1TB'],
};

const APPAREL_VARIANT_CONFIG: CategoryVariantConfig = {
  kind: 'attribute',
  label: 'Size',
  options: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
};

// Subcategory-level overrides: a category's variantConfig is just the default for
// its subcategories, but some subcategories need a genuinely different unit/variant
// setup than their siblings — e.g. Fashion's Footwear needs shoe sizes, not the
// clothing XS-XXL its category default uses; a mobile accessory (cable, case) isn't
// sold by storage capacity the way the Mobiles category's phones are.
const FOOTWEAR_VARIANT_CONFIG: CategoryVariantConfig = {
  kind: 'attribute',
  label: 'Shoe Size',
  options: ['UK 6', 'UK 7', 'UK 8', 'UK 9', 'UK 10', 'UK 11'],
};

const ACCESSORY_VARIANT_CONFIG: CategoryVariantConfig = {
  kind: 'weight_volume',
  label: 'Quantity',
  units: ['pcs', 'set', 'm'],
};

// No real product photography exists for these demo listings yet (vendors upload
// their own via the app), so each gets a distinct, clearly-labelled placeholder
// instead of every product sharing the same generic image. Colour-coded per
// category so the catalog also reads visually distinct browsing by category.
const CATEGORY_PLACEHOLDER_COLORS: Record<string, string> = {
  grocery: '1CA672',
  snacks: 'F59E0B',
  'personal-care': 'EC4899',
  household: '0EA5E9',
  'baby-pet': '8B5CF6',
  electronics: '334155',
  mobiles: '1E293B',
  fashion: 'DB2777',
  kids: 'FB923C',
  healthcare: '059669',
  gifting: 'D946EF',
  paanstore: '65A30D',
  monsoon: '2563EB',
};

function placeholderImageUrl(name: string, categorySlug: string, variantLabel?: string): string {
  const bg = CATEGORY_PLACEHOLDER_COLORS[categorySlug] ?? '6B7280';
  const text = variantLabel ? `${name}\n${variantLabel}` : name;
  // Force PNG (placehold.co defaults to SVG, which React Native's <Image> can't render).
  return `https://placehold.co/600x600/${bg}/FFFFFF/png?text=${encodeURIComponent(text)}&font=roboto`;
}

// A few products get extra angle shots so the customer app's product-detail
// image carousel has something real to page through instead of a single image.
const MULTI_IMAGE_VARIANTS = ['Front', 'Back', 'Zoom'];
const PRODUCTS_WITH_MULTIPLE_IMAGES = new Set(['Fortune Sunflower Oil', 'Redmi 13C 4G Smartphone']);

function placeholderImageUrls(name: string, categorySlug: string): string[] {
  if (!PRODUCTS_WITH_MULTIPLE_IMAGES.has(name)) return [placeholderImageUrl(name, categorySlug)];
  return MULTI_IMAGE_VARIANTS.map((variant) => placeholderImageUrl(name, categorySlug, variant));
}

/**
 * Dev-only convenience seed for the core-commerce domain (categories, an
 * approved demo vendor, products, a coupon) so the customer/vendor/admin apps
 * have real data to render instead of an empty catalog. Idempotent — safe to
 * re-run against the same database.
 */
async function main() {
  await connectDb();
  await ensureDefaultAdmin();

  const vendorPhone = '9876500001';
  let vendor = await Vendor.findOne({ phone: vendorPhone });
  if (!vendor) {
    vendor = await Vendor.create({
      phone: vendorPhone,
      email: 'demo.vendor@verdant.com',
      passwordHash: await bcrypt.hash('vendor@123', 10),
      fullName: 'Demo Vendor',
      status: 'active',
      kycStatus: 'verified',
      registrationStep: 'submitted',
      referenceId: 'VND-DEMO-0001',
      businessType: 'proprietorship',
      storeProfile: {
        storeName: 'Fresh Mart Koramangala',
        description: 'Your neighbourhood quick-commerce store',
        primaryCategory: 'Grocery',
        subCategory: 'Supermarket',
        tags: ['grocery', 'fresh'],
        minimumOrderValue: '99',
        avgPrepTime: '10',
      },
      storeSetupStep: 'complete',
      storeSetupCompletedAt: new Date(),
      storeStatus: 'open',
      storeStatusSetAt: new Date(),
    });
    console.log(`Created demo vendor ${vendor.phone} (password: vendor@123)`);
  }

  // This taxonomy (slugs + subcategory ids) matches Verdant's bundled category
  // illustration set exactly (see Verdant/src/data/categories.ts and
  // Verdant/src/utils/categoryIcon.ts) so seeded categories render their real icons
  // instead of falling back to a generic placeholder.
  const categoryDefs = [
    {
      name: 'Grocery',
      slug: 'grocery',
      variantConfig: WEIGHT_VOLUME_VARIANT_CONFIG,
      subs: [
        { id: 'fruits-vegetables', name: 'Fruits & Vegetables' },
        { id: 'dairy-breakfast', name: 'Dairy & Breakfast' },
        { id: 'staples', name: 'Staples' },
        { id: 'bakery', name: 'Bakery' },
        { id: 'frozen-foods', name: 'Frozen Foods' },
      ],
    },
    {
      name: 'Snacks & Beverages',
      slug: 'snacks',
      variantConfig: WEIGHT_VOLUME_VARIANT_CONFIG,
      subs: [
        { id: 'chips-snacks', name: 'Chips & Snacks' },
        { id: 'chocolates', name: 'Chocolates' },
        { id: 'soft-drinks', name: 'Soft Drinks' },
        { id: 'juices', name: 'Juices' },
        { id: 'tea-coffee', name: 'Tea & Coffee' },
      ],
    },
    {
      name: 'Personal Care',
      slug: 'personal-care',
      variantConfig: WEIGHT_VOLUME_VARIANT_CONFIG,
      subs: [
        { id: 'bath-body', name: 'Bath & Body' },
        { id: 'hair-care', name: 'Hair Care' },
        { id: 'oral-care', name: 'Oral Care' },
        { id: 'grooming', name: 'Grooming' },
      ],
    },
    {
      name: 'Household',
      slug: 'household',
      variantConfig: WEIGHT_VOLUME_VARIANT_CONFIG,
      subs: [
        { id: 'cleaning', name: 'Cleaning' },
        { id: 'laundry', name: 'Laundry' },
        { id: 'kitchen', name: 'Kitchen' },
        { id: 'home-essentials', name: 'Home Essentials' },
      ],
    },
    {
      name: 'Baby & Pet',
      slug: 'baby-pet',
      variantConfig: WEIGHT_VOLUME_VARIANT_CONFIG,
      subs: [
        { id: 'baby-care', name: 'Baby Care' },
        { id: 'pet-food', name: 'Pet Food' },
        { id: 'pet-essentials', name: 'Pet Essentials' },
      ],
    },
    // The categories below back Verdant's HomeScreen "shop by store" tab row
    // (Verdant/src/data/home.ts categoryTabs) — each tab maps to one of these
    // real categories (see Verdant/src/data/categoryTabTargets.ts) instead of
    // navigating nowhere with no backing data.
    {
      name: 'Electronics',
      slug: 'electronics',
      variantConfig: ELECTRONICS_VARIANT_CONFIG,
      subs: [
        { id: 'mobile-accessories', name: 'Mobile Accessories', variantConfig: ACCESSORY_VARIANT_CONFIG },
        { id: 'small-appliances', name: 'Small Appliances' },
        { id: 'gadgets', name: 'Gadgets' },
      ],
    },
    {
      name: 'Mobiles',
      slug: 'mobiles',
      variantConfig: ELECTRONICS_VARIANT_CONFIG,
      subs: [
        { id: 'smartphones', name: 'Smartphones' },
        { id: 'mobile-accessories', name: 'Mobile Accessories', variantConfig: ACCESSORY_VARIANT_CONFIG },
      ],
    },
    {
      name: 'Fashion',
      slug: 'fashion',
      variantConfig: APPAREL_VARIANT_CONFIG,
      subs: [
        { id: 'mens-wear', name: "Men's Wear" },
        { id: 'womens-wear', name: "Women's Wear" },
        { id: 'footwear', name: 'Footwear', variantConfig: FOOTWEAR_VARIANT_CONFIG },
      ],
    },
    {
      name: 'Kids',
      slug: 'kids',
      variantConfig: APPAREL_VARIANT_CONFIG,
      subs: [
        { id: 'toys', name: 'Toys' },
        { id: 'stationery', name: 'Stationery' },
        { id: 'kids-wear', name: 'Kids Wear' },
      ],
    },
    {
      name: 'Healthcare',
      slug: 'healthcare',
      variantConfig: WEIGHT_VOLUME_VARIANT_CONFIG,
      subs: [
        { id: 'otc-medicines', name: 'OTC Medicines' },
        { id: 'health-devices', name: 'Health Devices' },
        { id: 'wellness', name: 'Wellness' },
      ],
    },
    {
      name: 'Gifting',
      slug: 'gifting',
      variantConfig: WEIGHT_VOLUME_VARIANT_CONFIG,
      subs: [
        { id: 'gift-hampers', name: 'Gift Hampers' },
        { id: 'greeting-cards', name: 'Greeting Cards' },
      ],
    },
    {
      name: 'Paan Store',
      slug: 'paanstore',
      variantConfig: WEIGHT_VOLUME_VARIANT_CONFIG,
      subs: [
        { id: 'mouth-fresheners', name: 'Mouth Fresheners' },
        { id: 'paan-corner', name: 'Paan Corner' },
      ],
    },
    {
      name: 'Monsoon Store',
      slug: 'monsoon',
      variantConfig: WEIGHT_VOLUME_VARIANT_CONFIG,
      subs: [
        { id: 'rainwear', name: 'Rainwear' },
        { id: 'umbrellas', name: 'Umbrellas' },
      ],
    },
  ];

  const categories: Record<string, InstanceType<typeof Category>> = {};
  for (let i = 0; i < categoryDefs.length; i++) {
    const def = categoryDefs[i];
    let category = await Category.findOne({ slug: def.slug });
    if (!category) {
      category = await Category.create({
        name: def.name,
        slug: def.slug,
        sortOrder: i,
        isActive: true,
        showOnHome: true,
        subcategories: def.subs.map((sub) => ({
          id: sub.id,
          name: sub.name,
          isActive: true,
          variantConfig: sub.variantConfig,
        })),
        variantConfig: def.variantConfig,
      });
    } else {
      // Backfill any subcategories missing from an older seed run, without touching
      // ones that already exist (which may since have real products attached).
      const existingIds = new Set(category.subcategories.map((s) => s.id));
      const missing = def.subs.filter((sub) => !existingIds.has(sub.id));
      let changed = false;
      if (missing.length > 0) {
        category.subcategories.push(
          ...missing.map((sub) => ({ id: sub.id, name: sub.name, isActive: true, variantConfig: sub.variantConfig })),
        );
        changed = true;
      }
      // Backfill variantConfig onto categories/subcategories seeded before this field
      // existed, without overwriting a config an admin has since customized.
      if (!category.variantConfig) {
        category.variantConfig = def.variantConfig;
        changed = true;
      }
      for (const subDef of def.subs) {
        if (!subDef.variantConfig) continue;
        const sub = category.subcategories.find((s) => s.id === subDef.id);
        if (sub && !sub.variantConfig) {
          sub.variantConfig = subDef.variantConfig;
          changed = true;
        }
      }
      if (changed) await category.save();
    }
    categories[def.slug] = category;
  }

  const productDefs = [
    { name: 'Fortune Sunflower Oil', brand: 'Fortune', category: 'grocery', sub: 'staples', tags: ['deal', 'essential'], variants: [{ id: 'v-500ml', label: '500 ml', mrp: 175, price: 148 }, { id: 'v-1l', label: '1 L', mrp: 320, price: 279 }] },
    { name: 'Amul Gold Full Cream Milk', brand: 'Amul', category: 'grocery', sub: 'dairy-breakfast', tags: ['essential'], variants: [{ id: 'v-500ml', label: '500 ml', mrp: 35, price: 32 }] },
    { name: 'Farm Fresh Eggs (12 pack)', brand: 'Farm Fresh', category: 'grocery', sub: 'dairy-breakfast', tags: ['essential', 'saver'], variants: [{ id: 'v-12pc', label: '12 pieces', mrp: 96, price: 89 }] },
    { name: 'Tata Salt', brand: 'Tata', category: 'grocery', sub: 'staples', tags: ['saver', 'essential'], variants: [{ id: 'v-1kg', label: '1 kg', mrp: 25, price: 22 }] },
    { name: 'Fresh Bananas', brand: 'Farm Fresh', category: 'grocery', sub: 'fruits-vegetables', tags: ['deal'], variants: [{ id: 'v-1dz', label: '1 dozen', mrp: 60, price: 49 }] },
    { name: 'Fresh Tomatoes', brand: 'Farm Fresh', category: 'grocery', sub: 'fruits-vegetables', tags: ['deal', 'saver'], variants: [{ id: 'v-1kg', label: '1 kg', mrp: 40, price: 30 }] },
    { name: "Lay's Classic Salted Chips", brand: "Lay's", category: 'snacks', sub: 'chips-snacks', tags: ['deal', 'snack'], variants: [{ id: 'v-52g', label: '52 g', mrp: 20, price: 20 }] },
    { name: 'Coca-Cola', brand: 'Coca-Cola', category: 'snacks', sub: 'soft-drinks', tags: ['saver', 'snack'], variants: [{ id: 'v-750ml', label: '750 ml', mrp: 45, price: 40 }] },
    { name: "Haldiram's Bhujia Sev", brand: "Haldiram's", category: 'snacks', sub: 'chips-snacks', tags: ['snack'], variants: [{ id: 'v-200g', label: '200 g', mrp: 55, price: 49 }] },
    { name: "Britannia Good Day Cookies", brand: 'Britannia', category: 'snacks', sub: 'chips-snacks', tags: ['snack', 'saver'], variants: [{ id: 'v-100g', label: '100 g', mrp: 30, price: 26 }] },
    { name: 'Pears Soap', brand: 'Pears', category: 'personal-care', sub: 'bath-body', tags: ['essential'], variants: [{ id: 'v-125g', label: '125 g', mrp: 55, price: 49 }] },
    { name: 'Colgate Strong Teeth Toothpaste', brand: 'Colgate', category: 'personal-care', sub: 'oral-care', tags: ['essential'], variants: [{ id: 'v-200g', label: '200 g', mrp: 105, price: 92 }] },
    { name: 'Vim Dishwash Gel', brand: 'Vim', category: 'household', sub: 'cleaning', tags: ['essential'], variants: [{ id: 'v-500ml', label: '500 ml', mrp: 130, price: 109 }] },
    { name: 'Surf Excel Detergent', brand: 'Surf Excel', category: 'household', sub: 'laundry', tags: ['saver'], variants: [{ id: 'v-1kg', label: '1 kg', mrp: 150, price: 129 }] },
    { name: 'Pampers Baby Diapers', brand: 'Pampers', category: 'baby-pet', sub: 'baby-care', tags: ['essential'], variants: [{ id: 'v-m34', label: 'M, 34 pcs', mrp: 599, price: 519 }] },
    { name: 'Pedigree Adult Dog Food', brand: 'Pedigree', category: 'baby-pet', sub: 'pet-food', tags: ['essential'], variants: [{ id: 'v-3kg', label: '3 kg', mrp: 750, price: 675 }] },

    { name: 'boAt Bassheads 100 Wired Earphones', brand: 'boAt', category: 'electronics', sub: 'mobile-accessories', tags: ['deal'], variants: [{ id: 'v-1pc', label: '1 piece', mrp: 599, price: 399 }] },
    { name: 'Philips Hand Blender', brand: 'Philips', category: 'electronics', sub: 'small-appliances', tags: [], variants: [{ id: 'v-1pc', label: '1 piece', mrp: 1495, price: 1199 }] },

    { name: 'Redmi 13C 4G Smartphone', brand: 'Redmi', category: 'mobiles', sub: 'smartphones', tags: ['deal'], variants: [{ id: 'v-64gb', label: '64 GB', mrp: 9999, price: 8499 }] },
    { name: 'Type-C Fast Charging Cable', brand: 'Verdant Basics', category: 'mobiles', sub: 'mobile-accessories', tags: ['saver'], variants: [{ id: 'v-1m', label: '1 m', mrp: 299, price: 149 }] },

    { name: "Men's Cotton Round Neck T-Shirt", brand: 'Verdant Fashion', category: 'fashion', sub: 'mens-wear', tags: ['deal'], variants: [{ id: 'v-l', label: 'L', mrp: 599, price: 349 }] },
    { name: "Women's Casual Kurti", brand: 'Verdant Fashion', category: 'fashion', sub: 'womens-wear', tags: [], variants: [{ id: 'v-m', label: 'M', mrp: 899, price: 599 }] },

    { name: 'Building Blocks Toy Set', brand: 'PlayJoy', category: 'kids', sub: 'toys', tags: ['deal'], variants: [{ id: 'v-100pc', label: '100 pieces', mrp: 699, price: 449 }] },
    { name: 'Kids Colouring Book & Crayons Set', brand: 'PlayJoy', category: 'kids', sub: 'stationery', tags: ['essential'], variants: [{ id: 'v-1set', label: '1 set', mrp: 199, price: 149 }] },

    { name: 'Dettol Antiseptic Liquid', brand: 'Dettol', category: 'healthcare', sub: 'wellness', tags: ['essential'], variants: [{ id: 'v-550ml', label: '550 ml', mrp: 210, price: 189 }] },
    { name: 'Digital Thermometer', brand: 'Dr. Trust', category: 'healthcare', sub: 'health-devices', tags: [], variants: [{ id: 'v-1pc', label: '1 piece', mrp: 299, price: 219 }] },

    { name: 'Assorted Chocolate Gift Hamper', brand: 'Verdant Gifts', category: 'gifting', sub: 'gift-hampers', tags: ['deal'], variants: [{ id: 'v-1box', label: '1 box', mrp: 899, price: 649 }] },
    { name: 'Birthday Greeting Card', brand: 'Verdant Gifts', category: 'gifting', sub: 'greeting-cards', tags: [], variants: [{ id: 'v-1pc', label: '1 piece', mrp: 99, price: 79 }] },

    { name: 'Rajnigandha Silver Pearls Mouth Freshener', brand: 'Rajnigandha', category: 'paanstore', sub: 'mouth-fresheners', tags: [], variants: [{ id: 'v-1pc', label: '1 piece', mrp: 10, price: 10 }] },
    { name: 'Meetha Paan Masala', brand: 'Verdant Paan Corner', category: 'paanstore', sub: 'paan-corner', tags: ['saver'], variants: [{ id: 'v-100g', label: '100 g', mrp: 60, price: 52 }] },

    { name: 'Reusable Rain Poncho', brand: 'Verdant Basics', category: 'monsoon', sub: 'rainwear', tags: ['monsoon', 'deal'], variants: [{ id: 'v-1pc', label: '1 piece', mrp: 299, price: 199 }] },
    { name: 'Automatic 3-Fold Umbrella', brand: 'Verdant Basics', category: 'monsoon', sub: 'umbrellas', tags: ['monsoon'], variants: [{ id: 'v-1pc', label: '1 piece', mrp: 599, price: 449 }] },
    { name: 'Waterproof Shoe Cover Pair', brand: 'Verdant Basics', category: 'monsoon', sub: 'rainwear', tags: ['monsoon', 'saver'], variants: [{ id: 'v-1pr', label: '1 pair', mrp: 199, price: 129 }] },
  ];

  const products: Record<string, InstanceType<typeof Product>> = {};
  for (const def of productDefs) {
    const category = categories[def.category];
    let product = await Product.findOne({ vendorId: vendor._id, name: def.name });
    if (!product) {
      const subcategory = category.subcategories.find((s) => s.id === def.sub);
      product = await Product.create({
        vendorId: vendor._id,
        categoryId: category._id,
        subcategoryId: subcategory?.id,
        name: def.name,
        description: `${def.name} — fresh and delivered fast.`,
        brand: def.brand,
        countryOfOrigin: 'India',
        unit: def.variants[0].label,
        images: placeholderImageUrls(def.name, def.category),
        variants: def.variants.map((v) => ({ ...v, stock: 100 })),
        tags: def.tags,
        taxRate: 5,
        status: 'active',
        isAvailable: true,
      });
    } else {
      // Backfill fields onto products created by an older seed run (before these
      // existed here) so highlights and per-product images reflect real values.
      let changed = false;
      if (!product.brand) {
        product.brand = def.brand;
        product.countryOfOrigin = 'India';
        changed = true;
      }
      const hasNoImage = product.images.length === 0;
      // Earlier run of this script saved placehold.co's default SVG format, which
      // React Native's <Image> can't render — regenerate those onto the PNG variant.
      const hasUnrenderableSvgPlaceholder =
        product.images[0]?.includes('placehold.co') && !product.images[0].includes('/png');
      const missingMultipleImages =
        PRODUCTS_WITH_MULTIPLE_IMAGES.has(def.name) && product.images.length < MULTI_IMAGE_VARIANTS.length;
      if (hasNoImage || hasUnrenderableSvgPlaceholder || missingMultipleImages) {
        product.images = placeholderImageUrls(def.name, def.category);
        changed = true;
      }
      if (changed) await product.save();
    }
    products[def.name] = product;
  }

  // A handful of demo reviews so the customer app's product-detail rating/review
  // section reflects real (if seeded) data instead of a hardcoded placeholder.
  const reviewDefs: { product: string; reviews: { customerName: string; rating: number; comment?: string }[] }[] = [
    {
      product: 'Fortune Sunflower Oil',
      reviews: [
        { customerName: 'Ananya R.', rating: 5, comment: 'Good quality oil, delivered fast.' },
        { customerName: 'Vikram S.', rating: 4, comment: 'Value for money, will order again.' },
        { customerName: 'Priya M.', rating: 4 },
      ],
    },
    {
      product: 'Amul Gold Full Cream Milk',
      reviews: [
        { customerName: 'Rahul K.', rating: 5, comment: 'Always fresh, on time delivery.' },
        { customerName: 'Sneha T.', rating: 5 },
      ],
    },
    {
      product: "Lay's Classic Salted Chips",
      reviews: [
        { customerName: 'Arjun P.', rating: 4, comment: 'Classic taste, packaging was fine.' },
        { customerName: 'Meera N.', rating: 3, comment: 'A bit pricier than the store nearby.' },
      ],
    },
    {
      product: 'Pears Soap',
      reviews: [
        { customerName: 'Kavya S.', rating: 5, comment: 'Genuine product, nice fragrance.' },
        { customerName: 'Rohan D.', rating: 4 },
        { customerName: 'Divya J.', rating: 5, comment: 'My go-to soap, quick delivery too.' },
      ],
    },
    {
      product: 'Vim Dishwash Gel',
      reviews: [
        { customerName: 'Aditya V.', rating: 4, comment: 'Works well, lasts long.' },
        { customerName: 'Neha G.', rating: 4 },
      ],
    },
    {
      product: 'boAt Bassheads 100 Wired Earphones',
      reviews: [
        { customerName: 'Karan M.', rating: 4, comment: 'Decent sound for the price.' },
        { customerName: 'Ishita B.', rating: 3, comment: 'Bass is good but build feels light.' },
      ],
    },
    {
      product: 'Redmi 13C 4G Smartphone',
      reviews: [
        { customerName: 'Suresh N.', rating: 5, comment: 'Great value smartphone, battery lasts all day.' },
        { customerName: 'Pooja L.', rating: 4 },
        { customerName: 'Manish A.', rating: 4, comment: 'Camera is decent for this price range.' },
      ],
    },
    {
      product: "Men's Cotton Round Neck T-Shirt",
      reviews: [
        { customerName: 'Farhan I.', rating: 4, comment: 'Good fit, fabric feels nice.' },
        { customerName: 'Tanvi R.', rating: 5 },
      ],
    },
  ];

  for (const def of reviewDefs) {
    const product = products[def.product];
    if (!product) continue;
    const existingCount = await Review.countDocuments({ productId: product._id });
    if (existingCount > 0) continue;
    await Review.insertMany(def.reviews.map((r) => ({ productId: product._id, ...r })));
  }

  const existingCoupon = await Coupon.findOne({ code: 'FRESH50' });
  if (!existingCoupon) {
    await Coupon.create({
      code: 'FRESH50',
      description: 'Flat ₹50 off on orders above ₹199',
      discountType: 'flat',
      value: 50,
      minOrderValue: 199,
      isActive: true,
    });
  }

  console.log('Catalog seed complete.');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
