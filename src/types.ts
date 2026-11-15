export type ServiceType = "PICKUP" | "DELIVERY";

export interface TokensData {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  token_type?: string;
  expires_in?: number;
  expires_at?: string;
  saved_at?: string;
  scope?: string;
  customer_id?: string;
}

export type MtlsCertSource = "env" | "container" | "config_dir" | "none";

export interface MtlsCertStatus {
  configured: boolean;
  source: MtlsCertSource;
  certPath?: string;
  keyPath?: string;
  subject?: string;
  issuer?: string;
  validTo?: string;
  message?: string;
}

export interface MarketConfig {
  marketId: string;
  zipCode: string;
  serviceType: ServiceType;
  marketName?: string;
  city?: string;
  updatedAt?: string;
}

export interface AuthSessionStatus {
  authenticated: boolean;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  expiresAt?: string;
  expiresInSeconds?: number;
  savedAt?: string;
  tokenSource: "request" | "file" | "env" | "none";
  tokensFile: string;
  customerId?: string;
  mtlsConfigured: boolean;
  mtlsSource: MtlsCertSource;
  mtlsCertPath?: string;
  mtlsKeyPath?: string;
  marketConfig: MarketConfig;
  message?: string;
}

export interface MarketInfo {
  id: string;
  wwIdent: string;
  name: string;
  companyName?: string;
  street?: string;
  zipCode?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  distanceKm?: number;
  openingStatus?: string;
  openingInfoText?: string;
  isOpen?: boolean;
  hasPickup?: boolean;
  isPickupStation?: boolean;
}

export interface MarketDetails extends MarketInfo {
  phone?: string;
  typeId?: string;
  addressLine?: string;
  openingHours?: Array<{ days: string; hours: string }>;
  specialOpeningHours?: Array<{ date: string; hours: string }>;
  services?: Array<{ name: string; active: boolean; tooltip?: string }>;
  raw?: unknown;
}

export interface PickupMarketSummary {
  wwIdent: string;
  name?: string;
  companyName?: string;
  street?: string;
  zipCode?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  isPickupStation?: boolean;
  pickupType?: string;
  serviceTypes: string[];
}

export interface ServicePortfolio {
  zipCode: string;
  customerZipCode?: string;
  deliveryMarketId?: string;
  pickupMarkets: PickupMarketSummary[];
  availableServiceTypes: string[];
}

export interface ReweDiscount {
  id: string;
  articleId?: string;
  nan?: string;
  title: string;
  subtitle?: string;
  price?: number;
  rawPrice?: string;
  originalPrice?: string;
  discountLabel?: string;
  basePrice?: string;
  categoryId?: string;
  categoryTitle?: string;
  manufacturer?: string;
  validUntil?: string;
  imageUrl?: string;
  loyaltyBonusEuros?: number;
  biocide?: boolean;
  nutriScore?: string;
}

export interface ReweDiscountCategory {
  id: string;
  title: string;
  index: number;
  offerCount: number;
  offers: ReweDiscount[];
}

export interface MarketDiscountsResult {
  marketId: string;
  validUntil?: string;
  handoutUrl?: string;
  totalOffers: number;
  categories: ReweDiscountCategory[];
}

export interface ReweProduct {
  id: string;
  listingId?: string;
  articleId?: string;
  nan?: string;
  title: string;
  price?: number;
  rawPrice?: string;
  originalPrice?: string;
  basePrice?: string;
  grammage?: string;
  imageUrl?: string;
  categoryPath?: string;
  brand?: string;
  nutriScore?: string;
  orderLimit?: number;
  isAvailable?: boolean;
  isBulkyGood?: boolean;
  isOrganic?: boolean;
  isVegan?: boolean;
  isVegetarian?: boolean;
  isRegional?: boolean;
  serviceTypes?: string[];
}

export interface ReweProductDetail extends ReweProduct {
  description?: string;
  ingredients?: string;
  allergens?: string;
  nutritionFacts?: Array<{ nutrient: string; valuePer100: string }>;
  manufacturer?: string;
  countryOfOrigin?: string;
  gtin?: string;
  raw?: unknown;
}

export interface ShopCategory {
  id: string;
  name: string;
  slug?: string;
  productCount?: number;
  imageUrl?: string;
  categoryTags?: string[];
  childCategories?: ShopCategory[];
}

export interface ProductRecall {
  id: string;
  title: string;
  reason?: string;
  affectedStates?: string[];
  mhd?: string;
  url?: string;
  publishedAt?: string;
}

export interface ReweRecipe {
  id: string;
  title: string;
  url?: string;
  imageUrl?: string;
  durationMinutes?: number;
  prepMinutes?: number;
  cookMinutes?: number;
  difficulty?: string;
  difficultyLevel?: number;
  portions?: number;
  category?: string;
}

export interface ReweRecipeDetail extends ReweRecipe {
  servingUnit?: string;
  tags?: string[];
  ingredients: Array<{
    id?: string;
    name: string;
    amount?: number;
    unit?: string;
    rawText?: string;
    nan?: string;
  }>;
  steps: Array<{
    stepNumber: number;
    title?: string;
    description: string;
  }>;
  nutrition?: Array<{
    title: string;
    amount: number;
    unit: string;
    rda?: number;
  }>;
  raw?: unknown;
}

export interface MemberProfile {
  sub?: string;
  email?: string;
  emailVerified?: boolean;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  reweId?: string;
  customerId?: string;
  marketId?: string;
  zipCode?: string;
  serviceType?: ServiceType;
  raw?: unknown;
}

export interface BonusSummary {
  balanceEuros?: number;
  balanceCents?: number;
  loyaltyPoints?: number;
  statusTier?: string;
  referralCredits?: number;
  activeBoosters?: number;
  missionsCount?: number;
  raw?: unknown;
}

export interface ReweCoupon {
  id: string;
  title: string;
  subtitle?: string;
  description?: string;
  discountText?: string;
  activated: boolean;
  status?: string;
  validFrom?: string;
  validUntil?: string;
  imageUrl?: string;
  conditions?: string;
}

export interface EbonSummary {
  id: string;
  date: string;
  localDate?: string;
  marketId?: string;
  marketName?: string;
  marketStreet?: string;
  marketZipCode?: string;
  marketCity?: string;
  totalPrice: number;
  rawTotalPrice?: string;
  bonusEarned?: number;
  rawBonusEarned?: string;
  payType?: string;
  cancelled?: boolean;
}

export interface ReweOrderSummary {
  id: string;
  orderNumber?: string;
  status?: string;
  createdAt?: string;
  localDate?: string;
  serviceType?: string;
  totalPrice?: number;
  rawTotalPrice?: string;
  itemCount?: number;
  marketId?: string;
  pickupOrDeliveryTime?: string;
}

export interface ReweOrderLineItem {
  id?: string;
  productId?: string;
  listingId?: string;
  nan?: string;
  name: string;
  quantity: number;
  unitPrice?: number;
  totalPrice?: number;
  imageUrl?: string;
}

export interface ReweOrderDetail extends ReweOrderSummary {
  articlesPrice?: number;
  items: ReweOrderLineItem[];
  raw?: unknown;
}

export interface FavoriteListItem {
  id: string;
  itemId?: string;
  listingId?: string;
  productId?: string;
  articleId?: string;
  nan?: string;
  title: string;
  quantity?: number;
  price?: number;
  rawPrice?: string;
  grammage?: string;
  imageUrl?: string;
}

export interface FavoriteList {
  id: string;
  name?: string;
  itemCount: number;
  items: FavoriteListItem[];
}

export interface ReweBasketItem {
  id: string;
  productId?: string;
  listingId: string;
  nan?: string;
  title: string;
  quantity: number;
  unitPrice?: number;
  totalPrice?: number;
  rawTotalPrice?: string;
  grammage?: string;
  imageUrl?: string;
}

export interface ReweBasket {
  id: string;
  version?: number;
  serviceType: ServiceType;
  marketId: string;
  zipCode: string;
  itemCount: number;
  totalQuantity: number;
  articlesPrice?: number;
  totalPrice?: number;
  rawTotalPrice?: string;
  minimumOrderValue?: number;
  minimumOrderReached?: boolean;
  remainingForMinimum?: number;
  timeslotText?: string;
  items: ReweBasketItem[];
}

export interface Timeslot {
  id: string;
  start: string;
  end: string;
  date?: string;
  formattedTime?: string;
  price?: number;
  rawPrice?: string;
  available: boolean;
  type?: string;
}

export interface RegularProductSummary {
  normalizedName: string;
  displayName: string;
  aliases: string[];
  productIds: string[];
  listingIds: string[];
  nans: string[];
  purchaseCount: number;
  totalQuantity: number;
  averageUnitPrice?: number;
  lastUnitPrice?: number;
  lastPurchasedDate?: string;
  lastPurchasedLocalDate?: string;
  daysSinceLastPurchase?: number;
  averageCadenceDays?: number;
  dueForRestock: boolean;
  sources: string[];
}

export interface RegularProductsResult {
  ordersAvailable: number;
  ordersAnalyzed: number;
  purchasedProductsCount: number;
  ebonsCount: number;
  minPurchases: number;
  totalUniqueItems: number;
  regularProducts: RegularProductSummary[];
  note?: string;
}

export interface MatchedOfferSummary {
  id: string;
  title: string;
  subtitle?: string;
  nan?: string;
  price?: number;
  rawPrice?: string;
  discountLabel?: string;
  categoryTitle?: string;
  validUntil?: string;
  matchScore: number;
}

export interface MatchedCouponSummary {
  id: string;
  title: string;
  subtitle?: string;
  discountText?: string;
  activated: boolean;
  validUntil?: string;
  matchScore: number;
}

export interface GroceryTripPlan {
  marketId: string;
  zipCode: string;
  serviceType: ServiceType;
  ordersAnalyzed: number;
  minPurchases: number;
  offersChecked: number;
  couponsChecked: number;
  couponsError?: string;
  discountedRegulars: Array<{
    regular: RegularProductSummary;
    matchingOffers: MatchedOfferSummary[];
    matchingCoupons: MatchedCouponSummary[];
  }>;
  requestedItemDeals: Array<{
    query: string;
    matchingOffers: MatchedOfferSummary[];
    matchingCoupons: MatchedCouponSummary[];
  }>;
  dueForRestock: RegularProductSummary[];
  otherRegulars: RegularProductSummary[];
  unactivatedMatchingCoupons: Array<{
    id: string;
    title: string;
    discountText?: string;
    validUntil?: string;
    matchedItems: string[];
  }>;
  note?: string;
}
