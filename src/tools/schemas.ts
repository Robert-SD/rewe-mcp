import { z } from "zod";

const looseObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape).loose();

export const marketConfigSchema = looseObject({
  marketId: z.string(),
  zipCode: z.string(),
  serviceType: z.enum(["PICKUP", "DELIVERY"]),
  marketName: z.string().optional(),
  city: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const authStatusOutputSchema = looseObject({
  authenticated: z.boolean(),
  hasAccessToken: z.boolean(),
  hasRefreshToken: z.boolean(),
  expiresAt: z.string().optional(),
  expiresInSeconds: z.number().optional(),
  savedAt: z.string().optional(),
  tokenSource: z.enum(["request", "file", "env", "none"]),
  tokensFile: z.string(),
  customerId: z.string().optional(),
  mtlsConfigured: z.boolean(),
  mtlsSource: z.enum(["env", "container", "config_dir", "none"]),
  mtlsCertPath: z.string().optional(),
  mtlsKeyPath: z.string().optional(),
  marketConfig: marketConfigSchema,
  message: z.string().optional(),
});

export const memberProfileOutputSchema = looseObject({
  sub: z.string().optional(),
  email: z.string().optional(),
  emailVerified: z.boolean().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  fullName: z.string().optional(),
  reweId: z.string().optional(),
  customerId: z.string().optional(),
  marketId: z.string().optional(),
  zipCode: z.string().optional(),
  serviceType: z.enum(["PICKUP", "DELIVERY"]).optional(),
});

export const bonusOutputSchema = looseObject({
  balanceEuros: z.number().optional(),
  balanceCents: z.number().optional(),
  loyaltyPoints: z.number().optional(),
  statusTier: z.string().optional(),
  missionsCount: z.number().optional(),
});

export const couponSchema = looseObject({
  id: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  description: z.string().optional(),
  discountText: z.string().optional(),
  activated: z.boolean(),
  status: z.string().optional(),
  validFrom: z.string().optional(),
  validUntil: z.string().optional(),
  imageUrl: z.string().optional(),
  conditions: z.string().optional(),
});

export const couponsOutputSchema = looseObject({
  count: z.number().int(),
  coupons: z.array(couponSchema),
});

export const marketInfoSchema = looseObject({
  id: z.string(),
  wwIdent: z.string(),
  name: z.string(),
  companyName: z.string().optional(),
  street: z.string().optional(),
  zipCode: z.string().optional(),
  city: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  distanceKm: z.number().optional(),
  openingStatus: z.string().optional(),
  openingInfoText: z.string().optional(),
  isOpen: z.boolean().optional(),
  hasPickup: z.boolean().optional(),
  isPickupStation: z.boolean().optional(),
});

export const searchMarketsOutputSchema = looseObject({
  count: z.number().int(),
  markets: z.array(marketInfoSchema),
});

export const marketDetailsOutputSchema = looseObject({
  id: z.string(),
  wwIdent: z.string(),
  name: z.string(),
  phone: z.string().optional(),
  addressLine: z.string().optional(),
  openingHours: z.array(looseObject({ days: z.string(), hours: z.string() })).optional(),
  services: z
    .array(
      looseObject({
        name: z.string(),
        active: z.boolean(),
        tooltip: z.string().optional(),
      })
    )
    .optional(),
});

export const servicePortfolioOutputSchema = looseObject({
  zipCode: z.string(),
  customerZipCode: z.string().optional(),
  deliveryMarketId: z.string().optional(),
  pickupMarkets: z.array(looseObject({ wwIdent: z.string() })),
  availableServiceTypes: z.array(z.string()),
});

export const discountSchema = looseObject({
  id: z.string(),
  articleId: z.string().optional(),
  nan: z.string().optional(),
  title: z.string(),
  subtitle: z.string().optional(),
  price: z.number().optional(),
  rawPrice: z.string().optional(),
  originalPrice: z.string().optional(),
  discountLabel: z.string().optional(),
  basePrice: z.string().optional(),
  categoryId: z.string().optional(),
  categoryTitle: z.string().optional(),
  manufacturer: z.string().optional(),
  validUntil: z.string().optional(),
  imageUrl: z.string().optional(),
  loyaltyBonusEuros: z.number().optional(),
  nutriScore: z.string().optional(),
});

export const discountsOutputSchema = looseObject({
  marketId: z.string(),
  validUntil: z.string().optional(),
  handoutUrl: z.string().optional(),
  totalOffers: z.number().int(),
  categories: z.array(
    looseObject({
      id: z.string(),
      title: z.string(),
      index: z.number().int(),
      offerCount: z.number().int(),
      offers: z.array(discountSchema),
    })
  ),
});

export const searchDiscountsOutputSchema = looseObject({
  marketId: z.string(),
  query: z.string(),
  validUntil: z.string().optional(),
  totalMatches: z.number().int(),
  offers: z.array(discountSchema),
});

export const brochureOutputSchema = looseObject({
  marketId: z.string(),
  handout: z.unknown(),
});

export const productSchema = looseObject({
  id: z.string(),
  listingId: z.string().optional(),
  articleId: z.string().optional(),
  nan: z.string().optional(),
  title: z.string(),
  price: z.number().optional(),
  rawPrice: z.string().optional(),
  originalPrice: z.string().optional(),
  grammage: z.string().optional(),
  imageUrl: z.string().optional(),
  brand: z.string().optional(),
  nutriScore: z.string().optional(),
  isAvailable: z.boolean().optional(),
  isOrganic: z.boolean().optional(),
  isVegan: z.boolean().optional(),
  isRegional: z.boolean().optional(),
});

export const searchProductsOutputSchema = looseObject({
  marketId: z.string(),
  serviceType: z.enum(["PICKUP", "DELIVERY"]),
  page: z.number().int(),
  objectsPerPage: z.number().int(),
  totalPages: z.number().int().optional(),
  totalProducts: z.number().int().optional(),
  correctedQuery: z.string().optional(),
  products: z.array(productSchema),
});

export const productDetailsOutputSchema = looseObject({
  id: z.string(),
  title: z.string(),
  price: z.number().optional(),
  description: z.string().optional(),
  ingredients: z.string().optional(),
  allergens: z.string().optional(),
});

export const shopCategoriesOutputSchema = looseObject({
  count: z.number().int(),
  categories: z.array(
    looseObject({
      id: z.string(),
      name: z.string(),
      slug: z.string().optional(),
      productCount: z.number().int().optional(),
    })
  ),
});

export const recallsOutputSchema = looseObject({
  count: z.number().int(),
  recalls: z.array(
    looseObject({
      id: z.string(),
      title: z.string(),
      reason: z.string().optional(),
      url: z.string().optional(),
    })
  ),
});

export const recipeSchema = looseObject({
  id: z.string(),
  title: z.string(),
  url: z.string().optional(),
  imageUrl: z.string().optional(),
  durationMinutes: z.number().optional(),
  difficulty: z.string().optional(),
  portions: z.number().optional(),
});

export const searchRecipesOutputSchema = looseObject({
  totalCount: z.number().int(),
  recipes: z.array(recipeSchema),
});

export const recipeDetailsOutputSchema = looseObject({
  id: z.string(),
  title: z.string(),
  ingredients: z.array(
    looseObject({
      name: z.string(),
      amount: z.number().optional(),
      unit: z.string().optional(),
      rawText: z.string().optional(),
    })
  ),
  steps: z.array(
    looseObject({
      stepNumber: z.number().int(),
      description: z.string(),
    })
  ),
});

export const recipePopularTermsOutputSchema = looseObject({
  count: z.number().int(),
  terms: z.array(z.string()),
});

export const listEbonsOutputSchema = looseObject({
  ebonActive: z.boolean().optional(),
  totalCount: z.number().int(),
  receipts: z.array(
    looseObject({
      id: z.string(),
      date: z.string(),
      localDate: z.string().optional(),
      totalPrice: z.number(),
      marketName: z.string().optional(),
    })
  ),
});

export const ebonPdfOutputSchema = looseObject({
  id: z.string(),
  sizeBytes: z.number().int(),
  savedTo: z.string().optional(),
  base64Pdf: z.string().optional(),
});

export const listOrdersOutputSchema = looseObject({
  count: z.number().int(),
  orders: z.array(
    looseObject({
      id: z.string(),
      status: z.string().optional(),
      createdAt: z.string().optional(),
      totalPrice: z.number().optional(),
    })
  ),
});

export const orderDetailsOutputSchema = looseObject({
  id: z.string(),
  status: z.string().optional(),
  createdAt: z.string().optional(),
  totalPrice: z.number().optional(),
  items: z.array(
    looseObject({
      name: z.string(),
      quantity: z.number(),
      unitPrice: z.number().optional(),
      totalPrice: z.number().optional(),
    })
  ),
});

export const favoritesOutputSchema = looseObject({
  count: z.number().int(),
  lists: z.array(
    looseObject({
      id: z.string(),
      name: z.string().optional(),
      itemCount: z.number().int(),
      items: z.array(
        looseObject({
          id: z.string(),
          title: z.string(),
          listingId: z.string().optional(),
        })
      ),
    })
  ),
});

export const manageFavoriteOutputSchema = looseObject({
  action: z.enum(["add", "remove"]),
  listId: z.string(),
  result: z.unknown(),
});

export const basketOutputSchema = looseObject({
  id: z.string(),
  version: z.number().int().optional(),
  serviceType: z.enum(["PICKUP", "DELIVERY"]),
  marketId: z.string(),
  zipCode: z.string(),
  itemCount: z.number().int(),
  totalQuantity: z.number().int(),
  totalPrice: z.number().optional(),
  items: z.array(
    looseObject({
      id: z.string(),
      listingId: z.string(),
      title: z.string(),
      quantity: z.number().int(),
      unitPrice: z.number().optional(),
      totalPrice: z.number().optional(),
    })
  ),
});

export const timeslotsOutputSchema = looseObject({
  count: z.number().int(),
  timeslots: z.array(
    looseObject({
      id: z.string(),
      start: z.string(),
      end: z.string(),
      date: z.string().optional(),
      formattedTime: z.string().optional(),
      price: z.number().optional(),
      available: z.boolean(),
    })
  ),
});

export const regularProductSchema = looseObject({
  normalizedName: z.string(),
  displayName: z.string(),
  aliases: z.array(z.string()),
  purchaseCount: z.number().int(),
  totalQuantity: z.number().int(),
  averageUnitPrice: z.number().optional(),
  lastPurchasedDate: z.string().optional(),
  dueForRestock: z.boolean(),
});

export const regularProductsOutputSchema = looseObject({
  ordersAvailable: z.number().int(),
  ordersAnalyzed: z.number().int(),
  purchasedProductsCount: z.number().int(),
  ebonsCount: z.number().int(),
  minPurchases: z.number().int(),
  totalUniqueItems: z.number().int(),
  regularProducts: z.array(regularProductSchema),
  note: z.string().optional(),
});

export const tripPlanOutputSchema = looseObject({
  marketId: z.string(),
  zipCode: z.string(),
  serviceType: z.enum(["PICKUP", "DELIVERY"]),
  ordersAnalyzed: z.number().int(),
  minPurchases: z.number().int(),
  offersChecked: z.number().int(),
  couponsChecked: z.number().int(),
  discountedRegulars: z.array(looseObject({ regular: regularProductSchema })),
  requestedItemDeals: z.array(looseObject({ query: z.string() })),
  dueForRestock: z.array(regularProductSchema),
  otherRegulars: z.array(regularProductSchema),
  unactivatedMatchingCoupons: z.array(looseObject({ id: z.string(), title: z.string() })),
  note: z.string().optional(),
});
