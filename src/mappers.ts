import { normalizeReweTimestamp } from "./dates.js";
import {
  BonusSummary,
  EbonSummary,
  FavoriteList,
  FavoriteListItem,
  MarketConfig,
  MarketDetails,
  MarketDiscountsResult,
  MarketInfo,
  MemberProfile,
  PickupMarketSummary,
  ProductRecall,
  ReweBasket,
  ReweBasketItem,
  ReweCoupon,
  ReweDiscount,
  ReweDiscountCategory,
  ReweOrderDetail,
  ReweOrderLineItem,
  ReweOrderSummary,
  ReweProduct,
  ReweProductDetail,
  ReweRecipe,
  ReweRecipeDetail,
  ServicePortfolio,
  ShopCategory,
  Timeslot,
} from "./types.js";

/**
 * Parse German-formatted or standard currency strings into numeric EUR floats.
 * Examples: "1,99 €" -> 1.99, "ab 2,49€*" -> 2.49, "1.234,56 €" -> 1234.56, 3.5 -> 3.5
 */
export function parseGermanPrice(raw: unknown): number | undefined {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? Number(raw.toFixed(2)) : undefined;
  }
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  const deMatch = trimmed.match(/(-?\d{1,3}(?:\.\d{3})*),(\d{1,2})/);
  if (deMatch) {
    const euros = deMatch[1].replace(/\./g, "");
    const cents = deMatch[2].padEnd(2, "0");
    const parsed = Number.parseFloat(`${euros}.${cents}`);
    return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : undefined;
  }

  const enMatch = trimmed.match(/(-?\d+(?:\.\d{1,2})?)/);
  if (enMatch) {
    const parsed = Number.parseFloat(enMatch[1]);
    return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : undefined;
  }

  return undefined;
}

export function centsToEuros(raw: unknown): number | undefined {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? Number((raw / 100).toFixed(2)) : undefined;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (/^-?\d+$/.test(trimmed)) {
      return Number((Number.parseInt(trimmed, 10) / 100).toFixed(2));
    }
    return parseGermanPrice(trimmed);
  }
  return undefined;
}

function asFloat(raw: unknown): number | undefined {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw === "string") {
    const parsed = Number.parseFloat(raw.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function formatEurString(euros?: number): string | undefined {
  if (euros === undefined || !Number.isFinite(euros)) return undefined;
  return `${euros.toFixed(2).replace(".", ",")} €`;
}

export function mapMarketSummary(raw: any): MarketInfo {
  const m = raw?.market || raw || {};
  const wwIdent = String(m.wwIdent || m.id || m.marketCode || "");
  const name =
    m.name ||
    m.displayName ||
    m.category?.marketTypeDisplayName ||
    "REWE Markt";
  const openState = m.openingStatus?.openState || m.openState;
  const openingInfoText =
    m.openingStatus?.infoText ||
    (Array.isArray(m.openingInfo) && m.openingInfo[0]
      ? `${m.openingInfo[0].days}: ${m.openingInfo[0].hours}`
      : undefined);

  return {
    id: String(m.id || wwIdent),
    wwIdent,
    name: String(name),
    ...(m.companyName ? { companyName: String(m.companyName) } : {}),
    ...(m.street || m.streetWithHouseNumber
      ? { street: String(m.street || m.streetWithHouseNumber) }
      : {}),
    ...(m.zipCode ? { zipCode: String(m.zipCode) } : {}),
    ...(m.city ? { city: String(m.city) } : {}),
    ...(asFloat(m.location?.latitude ?? m.latitude) !== undefined
      ? { latitude: asFloat(m.location?.latitude ?? m.latitude) }
      : {}),
    ...(asFloat(m.location?.longitude ?? m.longitude) !== undefined
      ? { longitude: asFloat(m.location?.longitude ?? m.longitude) }
      : {}),
    ...(asFloat(m.distance) !== undefined ? { distanceKm: asFloat(m.distance) } : {}),
    ...(m.openingStatus?.statusText || openState
      ? { openingStatus: String(m.openingStatus?.statusText || openState) }
      : {}),
    ...(openingInfoText ? { openingInfoText } : {}),
    ...(openState ? { isOpen: String(openState).toUpperCase() === "OPEN" } : {}),
    ...(m.serviceFlags?.hasPickup !== undefined
      ? { hasPickup: Boolean(m.serviceFlags.hasPickup) }
      : {}),
    ...(m.isPickupStation !== undefined
      ? { isPickupStation: Boolean(m.isPickupStation) }
      : {}),
  };
}

export function mapMarketList(raw: any): MarketInfo[] {
  const container = raw?.marketSearch || raw?.markets || raw;
  const list = Array.isArray(container?.markets)
    ? container.markets
    : Array.isArray(container)
      ? container
      : [];
  return list.map(mapMarketSummary);
}

export function mapMarketDetails(raw: any): MarketDetails {
  const m = raw?.market || raw?.marketDetails || raw || {};
  const content = raw?.content || m.content || {};
  const base = mapMarketSummary(m);

  const openingHours = Array.isArray(m.openingInfo)
    ? m.openingInfo.map((o: any) => ({
        days: String(o.days || ""),
        hours: String(o.hours || ""),
      }))
    : undefined;

  const specialOpeningHours = Array.isArray(m.specialOpeningHours)
    ? m.specialOpeningHours.map((o: any) => ({
        date: String(o.date || o.day || ""),
        hours: String(o.hours || o.info || ""),
      }))
    : undefined;

  const rawServices: any[] = [
    ...(Array.isArray(content?.services?.fixed) ? content.services.fixed : []),
    ...(Array.isArray(content?.services?.editable) ? content.services.editable : []),
    ...(Array.isArray(m.services) ? m.services : []),
  ];
  const services =
    rawServices.length > 0
      ? rawServices
          .map((s) => ({
            name: String(s.text || s.name || s.title || ""),
            active: s.active !== undefined ? Boolean(s.active) : true,
            ...(s.tooltip ? { tooltip: String(s.tooltip) } : {}),
          }))
          .filter((s) => s.name)
      : undefined;

  const addressLine = [base.street, [base.zipCode, base.city].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");

  return {
    ...base,
    ...(m.phone ? { phone: String(m.phone) } : {}),
    ...(m.typeId ? { typeId: String(m.typeId) } : {}),
    ...(addressLine ? { addressLine } : {}),
    ...(openingHours?.length ? { openingHours } : {}),
    ...(specialOpeningHours?.length ? { specialOpeningHours } : {}),
    ...(services?.length ? { services } : {}),
    raw,
  };
}

export function mapServicePortfolio(raw: any, requestedZipCode: string): ServicePortfolio {
  const sp = raw?.servicePortfolio || raw || {};
  const deliveryMarketId = sp.deliveryMarket?.wwIdent
    ? String(sp.deliveryMarket.wwIdent)
    : undefined;

  const pickupMarkets: PickupMarketSummary[] = Array.isArray(sp.pickupMarkets)
    ? sp.pickupMarkets.map((pm: any) => ({
        wwIdent: String(pm.wwIdent || pm.id || ""),
        ...(pm.displayName || pm.name ? { name: String(pm.displayName || pm.name) } : {}),
        ...(pm.companyName ? { companyName: String(pm.companyName) } : {}),
        ...(pm.streetWithHouseNumber || pm.street
          ? { street: String(pm.streetWithHouseNumber || pm.street) }
          : {}),
        ...(pm.zipCode ? { zipCode: String(pm.zipCode) } : {}),
        ...(pm.city ? { city: String(pm.city) } : {}),
        ...(asFloat(pm.latitude) !== undefined ? { latitude: asFloat(pm.latitude) } : {}),
        ...(asFloat(pm.longitude) !== undefined ? { longitude: asFloat(pm.longitude) } : {}),
        ...(pm.isPickupStation !== undefined
          ? { isPickupStation: Boolean(pm.isPickupStation) }
          : {}),
        ...(pm.pickupType ? { pickupType: String(pm.pickupType) } : {}),
        serviceTypes: Array.isArray(pm.serviceTypes)
          ? pm.serviceTypes.map(String)
          : ["PICKUP"],
      }))
    : [];

  const availableServiceTypes: string[] = [];
  if (deliveryMarketId) availableServiceTypes.push("DELIVERY");
  if (pickupMarkets.length > 0) availableServiceTypes.push("PICKUP");

  return {
    zipCode: requestedZipCode,
    ...(sp.customerZipCode ? { customerZipCode: String(sp.customerZipCode) } : {}),
    ...(deliveryMarketId ? { deliveryMarketId } : {}),
    pickupMarkets,
    availableServiceTypes,
  };
}

function mapSingleDiscount(
  rawOffer: any,
  categoryId?: string,
  categoryTitle?: string,
  validUntil?: string
): ReweDiscount {
  const rawPrice =
    rawOffer?.priceData?.price ??
    rawOffer?.price?.formatted ??
    rawOffer?.formattedPrice ??
    (typeof rawOffer?.price === "string" ? rawOffer.price : undefined);
  const price =
    parseGermanPrice(rawPrice) ??
    (typeof rawOffer?.price === "number" ? rawOffer.price : undefined) ??
    centsToEuros(rawOffer?.priceData?.priceInCent ?? rawOffer?.priceInCent);

  let manufacturer: string | undefined;
  const contents = rawOffer?.detail?.contents;
  if (Array.isArray(contents)) {
    for (const c of contents) {
      if (Array.isArray(c?.titles)) {
        const hit = c.titles.find((t: string) => typeof t === "string" && t.startsWith("Hersteller: "));
        if (hit) {
          manufacturer = hit.slice("Hersteller: ".length).trim();
          break;
        }
      }
    }
  }

  let loyaltyBonusEuros: number | undefined;
  const lb = rawOffer?.loyaltyBonus;
  if (lb && typeof lb.bonusValue === "number" && lb.bonusValue > 0) {
    loyaltyBonusEuros =
      String(lb.bonusType || "").toLowerCase() === "cent"
        ? Number((lb.bonusValue / 100).toFixed(2))
        : Number(lb.bonusValue.toFixed(2));
  }

  const nan = rawOffer?.rawValues?.nan || rawOffer?.nan;
  const imageUrl =
    Array.isArray(rawOffer?.images) && rawOffer.images[0]
      ? String(rawOffer.images[0])
      : rawOffer?.imageUrl
        ? String(rawOffer.imageUrl)
        : undefined;

  return {
    id: String(rawOffer?.id || nan || rawOffer?.title || ""),
    ...(rawOffer?.rawValues?.articleId || rawOffer?.articleId
      ? { articleId: String(rawOffer?.rawValues?.articleId || rawOffer?.articleId) }
      : {}),
    ...(nan ? { nan: String(nan) } : {}),
    title: String(rawOffer?.title || "REWE Angebot"),
    ...(rawOffer?.subtitle ? { subtitle: String(rawOffer.subtitle) } : {}),
    ...(price !== undefined ? { price } : {}),
    ...(rawPrice ? { rawPrice: String(rawPrice) } : {}),
    ...(rawOffer?.priceData?.regularPrice
      ? { originalPrice: String(rawOffer.priceData.regularPrice) }
      : {}),
    ...(rawOffer?.priceData?.discount || rawOffer?.discountLabel
      ? { discountLabel: String(rawOffer?.priceData?.discount || rawOffer?.discountLabel) }
      : {}),
    ...(rawOffer?.priceData?.basePrice
      ? { basePrice: String(rawOffer.priceData.basePrice) }
      : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(rawOffer?.rawValues?.categoryTitle || categoryTitle
      ? { categoryTitle: String(rawOffer?.rawValues?.categoryTitle || categoryTitle) }
      : {}),
    ...(manufacturer ? { manufacturer } : {}),
    ...(validUntil ? { validUntil } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(loyaltyBonusEuros !== undefined ? { loyaltyBonusEuros } : {}),
    ...(rawOffer?.detail?.biocide !== undefined
      ? { biocide: Boolean(rawOffer.detail.biocide) }
      : {}),
    ...(rawOffer?.detail?.nutriScore
      ? { nutriScore: String(rawOffer.detail.nutriScore) }
      : {}),
  };
}

export function mapMarketDiscounts(raw: any, marketId: string): MarketDiscountsResult {
  const offersRoot = raw?.offers || raw || {};
  const activeWeek =
    offersRoot.defaultWeek === "next" && offersRoot.next?.available
      ? offersRoot.next
      : offersRoot.current || offersRoot;

  const validUntil = activeWeek?.untilDate || offersRoot.untilDate;
  const handoutUrl = activeWeek?.handoutUrl || offersRoot.handoutUrl;
  const rawCategories: any[] = Array.isArray(activeWeek?.categories)
    ? activeWeek.categories
    : [];

  let totalOffers = 0;
  const categories: ReweDiscountCategory[] = rawCategories.map((cat: any, idx: number) => {
    const catId = String(cat?.id || idx);
    const catTitle = String(cat?.title || "Angebote");
    const rawOffers: any[] = Array.isArray(cat?.offers) ? cat.offers : [];
    const offers: ReweDiscount[] = [];
    for (const ro of rawOffers) {
      // Skip purely decorative teaser tiles unless they look like product offers
      if (ro?.cellType && ro.cellType !== "DEFAULT" && !ro.title && !ro.priceData) {
        continue;
      }
      if (!ro?.title) continue;
      offers.push(mapSingleDiscount(ro, catId, catTitle, validUntil));
    }
    totalOffers += offers.length;
    return {
      id: catId,
      title: catTitle,
      index: typeof cat?.order === "number" ? cat.order : typeof cat?.index === "number" ? cat.index : idx,
      offerCount: offers.length,
      offers,
    };
  });

  return {
    marketId,
    ...(validUntil ? { validUntil: String(validUntil) } : {}),
    ...(handoutUrl ? { handoutUrl: String(handoutUrl) } : {}),
    totalOffers,
    categories,
  };
}

export function mapProductSummary(raw: any): ReweProduct {
  const p = raw?.product || raw || {};
  const listing = p.listing || p._embedded?.listing || {};
  const attrs = p.attributes || p._embedded?.attributes || {};

  const price =
    centsToEuros(listing.currentRetailPrice) ??
    parseGermanPrice(p.price) ??
    centsToEuros(p.priceInCent);
  const regularPrice =
    centsToEuros(listing.discount?.regularPrice) ?? parseGermanPrice(p.originalPrice);

  return {
    id: String(p.productId || p.id || ""),
    ...(listing.listingId || p.listingId
      ? { listingId: String(listing.listingId || p.listingId) }
      : {}),
    ...(p.articleId ? { articleId: String(p.articleId) } : {}),
    ...(p.nan ? { nan: String(p.nan) } : {}),
    title: String(p.title || p.name || p.productName || "REWE Produkt"),
    ...(price !== undefined ? { price } : {}),
    ...(price !== undefined ? { rawPrice: formatEurString(price) } : {}),
    ...(regularPrice !== undefined
      ? { originalPrice: formatEurString(regularPrice) }
      : {}),
    ...(listing.grammage || p.grammage
      ? { grammage: String(listing.grammage || p.grammage) }
      : {}),
    ...(p.imageURL || p.imageUrl || p.media?.images?.[0]?.large
      ? { imageUrl: String(p.imageURL || p.imageUrl || p.media?.images?.[0]?.large) }
      : {}),
    ...(p.categoryPath || p.categories?.[0]
      ? { categoryPath: String(p.categoryPath || p.categories?.[0]) }
      : {}),
    ...(p.brand?.name || p.brand ? { brand: String(p.brand?.name || p.brand) } : {}),
    ...(p.nutriScore || attrs.nutriScore
      ? { nutriScore: String(p.nutriScore || attrs.nutriScore) }
      : {}),
    ...(typeof p.orderLimit === "number" ? { orderLimit: p.orderLimit } : {}),
    ...(listing.isAvailable !== undefined
      ? { isAvailable: Boolean(listing.isAvailable) }
      : p.isAvailable !== undefined
        ? { isAvailable: Boolean(p.isAvailable) }
        : {}),
    ...(attrs.isBulkyGood !== undefined ? { isBulkyGood: Boolean(attrs.isBulkyGood) } : {}),
    ...(attrs.isOrganic !== undefined ? { isOrganic: Boolean(attrs.isOrganic) } : {}),
    ...(attrs.isVegan !== undefined ? { isVegan: Boolean(attrs.isVegan) } : {}),
    ...(attrs.isVegetarian !== undefined
      ? { isVegetarian: Boolean(attrs.isVegetarian) }
      : {}),
    ...(attrs.isRegional !== undefined ? { isRegional: Boolean(attrs.isRegional) } : {}),
    ...(Array.isArray(p.serviceTypes)
      ? { serviceTypes: p.serviceTypes.map(String) }
      : {}),
  };
}

export function mapProductDetail(raw: any): ReweProductDetail {
  const item = Array.isArray(raw?.product)
    ? raw.product[0]
    : raw?.product || (Array.isArray(raw) ? raw[0] : raw) || {};
  const base = mapProductSummary(item);

  const rawFacts =
    item.nutritionFacts?.nutrients ||
    item.nutritionInformation ||
    item.nutrients ||
    [];
  const nutritionFacts = Array.isArray(rawFacts)
    ? rawFacts
        .map((n: any) => ({
          nutrient: String(n.name || n.title || n.nutrient || ""),
          valuePer100: String(n.value || n.amount || n.valuePer100 || ""),
        }))
        .filter((n) => n.nutrient)
    : undefined;

  const ingredients =
    item.ingredientStatement ||
    item.ingredients ||
    item.detail?.ingredients ||
    undefined;
  const allergens =
    item.allergenStatement ||
    item.allergens ||
    (Array.isArray(item.allergenInformation)
      ? item.allergenInformation.join(", ")
      : undefined);

  return {
    ...base,
    ...(item.description || item.marketingText
      ? { description: String(item.description || item.marketingText) }
      : {}),
    ...(ingredients ? { ingredients: String(ingredients) } : {}),
    ...(allergens ? { allergens: String(allergens) } : {}),
    ...(nutritionFacts?.length ? { nutritionFacts } : {}),
    ...(item.manufacturer?.name || item.manufacturer
      ? { manufacturer: String(item.manufacturer?.name || item.manufacturer) }
      : {}),
    ...(item.countryOfOrigin || item.origin
      ? { countryOfOrigin: String(item.countryOfOrigin || item.origin) }
      : {}),
    ...(item.gtin || item.ean ? { gtin: String(item.gtin || item.ean) } : {}),
    raw: item,
  };
}

export function mapShopCategories(raw: any): ShopCategory[] {
  const list = Array.isArray(raw?.categories)
    ? raw.categories
    : Array.isArray(raw)
      ? raw
      : [];

  const convert = (cat: any): ShopCategory => ({
    id: String(cat.id || cat.slug || ""),
    name: String(cat.name || cat.slug || ""),
    ...(cat.slug ? { slug: String(cat.slug) } : {}),
    ...(typeof cat.productCount === "number" ? { productCount: cat.productCount } : {}),
    ...(cat.imageUrl ? { imageUrl: String(cat.imageUrl) } : {}),
    ...(Array.isArray(cat.categoryTags)
      ? { categoryTags: cat.categoryTags.map(String) }
      : {}),
    ...(Array.isArray(cat.childCategories) && cat.childCategories.length > 0
      ? { childCategories: cat.childCategories.map(convert) }
      : {}),
  });

  return list.map(convert);
}

export function mapProductRecalls(raw: any): ProductRecall[] {
  const list =
    raw?.productRecalls?.products ||
    raw?.products ||
    (Array.isArray(raw) ? raw : []);
  if (!Array.isArray(list)) return [];

  return list.map((r: any, idx: number) => ({
    id: String(r.id || r.url || `recall-${idx}`),
    title: String(r.subjectProduct || r.title || r.productName || "Rückruf"),
    ...(r.subjectReason || r.reason
      ? { reason: String(r.subjectReason || r.reason) }
      : {}),
    ...(Array.isArray(r.affectedStates)
      ? { affectedStates: r.affectedStates.map(String) }
      : {}),
    ...(r.mhd || r.bestBefore ? { mhd: String(r.mhd || r.bestBefore) } : {}),
    ...(r.url ? { url: String(r.url) } : {}),
    ...(r.publishedAt ? { publishedAt: String(r.publishedAt) } : {}),
  }));
}

function difficultyLabel(val: unknown): { level?: number; text?: string } {
  if (typeof val === "number") {
    if (val === 1) return { level: 1, text: "Gering" };
    if (val === 2) return { level: 2, text: "Mittel" };
    if (val === 3) return { level: 3, text: "Hoch" };
    return { level: val, text: String(val) };
  }
  if (typeof val === "string" && val) {
    return { text: val };
  }
  return {};
}

export function mapRecipeSummary(raw: any): ReweRecipe {
  const diff = difficultyLabel(raw?.difficulty);
  const durationMinutes =
    typeof raw?.timeTotal === "number"
      ? raw.timeTotal
      : typeof raw?.durationMinutes === "number"
        ? raw.durationMinutes
        : undefined;
  const imageUrl = Array.isArray(raw?.imageUrls)
    ? typeof raw.imageUrls[0] === "string"
      ? raw.imageUrls[0]
      : raw.imageUrls[0]?.urls?.default
    : raw?.imageUrl;

  return {
    id: String(raw?.id || ""),
    title: String(raw?.title || "REWE Rezept"),
    ...(raw?.detailUrl || raw?.url
      ? { url: String(raw.detailUrl || raw.url) }
      : {}),
    ...(imageUrl ? { imageUrl: String(imageUrl) } : {}),
    ...(durationMinutes !== undefined ? { durationMinutes } : {}),
    ...(typeof raw?.timePreparation === "number"
      ? { prepMinutes: raw.timePreparation }
      : {}),
    ...(typeof raw?.timeCooking === "number"
      ? { cookMinutes: raw.timeCooking }
      : {}),
    ...(diff.text ? { difficulty: diff.text } : {}),
    ...(diff.level !== undefined ? { difficultyLevel: diff.level } : {}),
    ...(typeof raw?.serving?.quantity === "number"
      ? { portions: raw.serving.quantity }
      : typeof raw?.portions === "number"
        ? { portions: raw.portions }
        : {}),
    ...(raw?.category ? { category: String(raw.category) } : {}),
  };
}

export function mapRecipeDetail(raw: any): ReweRecipeDetail {
  const r = raw?.recipeById || raw?.recipe || raw || {};
  const base = mapRecipeSummary(r);

  const ingredients = Array.isArray(r.ingredients)
    ? r.ingredients.map((ing: any) => ({
        ...(ing.id ? { id: String(ing.id) } : {}),
        name: String(ing.name || ing.displayName || ""),
        ...(typeof ing.quantity === "number"
          ? { amount: ing.quantity }
          : typeof ing.amount === "number"
            ? { amount: ing.amount }
            : {}),
        ...(ing.unit ? { unit: String(ing.unit) } : {}),
        ...(ing.displayName || ing.rawText
          ? { rawText: String(ing.displayName || ing.rawText) }
          : {}),
        ...(ing.nan ? { nan: String(ing.nan) } : {}),
      }))
    : [];

  const rawSteps = r.preparation?.steps || r.steps || [];
  const steps = Array.isArray(rawSteps)
    ? rawSteps.map((s: any, i: number) => ({
        stepNumber: typeof s.stepNumber === "number" ? s.stepNumber : i + 1,
        ...(s.title ? { title: String(s.title) } : {}),
        description: String(s.description || s.text || ""),
      }))
    : [];

  const nutrition = Array.isArray(r.nutrients)
    ? r.nutrients.map((n: any) => ({
        title: String(n.title || n.name || ""),
        amount: typeof n.amount === "number" ? n.amount : 0,
        unit: String(n.unit || ""),
        ...(typeof n.rda === "number" ? { rda: n.rda } : {}),
      }))
    : undefined;

  return {
    ...base,
    ...(r.serving?.type ? { servingUnit: String(r.serving.type) } : {}),
    ...(Array.isArray(r.tags) ? { tags: r.tags.map(String) } : {}),
    ingredients,
    steps,
    ...(nutrition?.length ? { nutrition } : {}),
    raw: r,
  };
}

export function mapMemberProfile(
  userinfo: any,
  customerData: any,
  reweIdData: any,
  marketConfig: MarketConfig
): MemberProfile {
  const customer = customerData?.customer || customerData || {};
  const reweId = reweIdData?.reweId || reweIdData || {};
  const firstName =
    userinfo?.given_name || customer?.firstName || undefined;
  const lastName =
    userinfo?.family_name || customer?.lastName || undefined;
  const fullName =
    userinfo?.name ||
    [firstName, lastName].filter(Boolean).join(" ") ||
    undefined;

  return {
    ...(userinfo?.sub ? { sub: String(userinfo.sub) } : {}),
    ...(userinfo?.email || customer?.email
      ? { email: String(userinfo?.email || customer?.email) }
      : {}),
    ...(userinfo?.email_verified !== undefined
      ? { emailVerified: Boolean(userinfo.email_verified) }
      : {}),
    ...(firstName ? { firstName: String(firstName) } : {}),
    ...(lastName ? { lastName: String(lastName) } : {}),
    ...(fullName ? { fullName } : {}),
    ...(reweId?.id || reweId?.reweId || reweId?.cardNumber
      ? { reweId: String(reweId.id || reweId.reweId || reweId.cardNumber) }
      : {}),
    ...(customer?.id || customer?.customerId
      ? { customerId: String(customer.id || customer.customerId) }
      : {}),
    marketId: marketConfig.marketId,
    zipCode: marketConfig.zipCode,
    serviceType: marketConfig.serviceType,
    raw: { userinfo, customer, reweId },
  };
}

export function mapBonusSummary(
  balanceData: any,
  accountData: any,
  loyaltyData: any,
  missionsData: any
): BonusSummary {
  const bal = balanceData?.balance || balanceData || {};
  const acc = accountData?.account || accountData || {};
  const loy = loyaltyData?.overview || loyaltyData || {};

  const balanceCents =
    typeof bal.balanceInCents === "number"
      ? bal.balanceInCents
      : typeof bal.amountInCent === "number"
        ? bal.amountInCent
        : typeof acc.balanceInCents === "number"
          ? acc.balanceInCents
          : undefined;
  const balanceEuros =
    typeof bal.balanceInEuro === "number"
      ? bal.balanceInEuro
      : typeof bal.amount === "number"
        ? bal.amount
        : centsToEuros(balanceCents) ?? parseGermanPrice(bal.formattedBalance);

  const loyaltyPoints =
    typeof loy.points === "number"
      ? loy.points
      : typeof loy.totalPoints === "number"
        ? loy.totalPoints
        : undefined;

  const missionsCount = Array.isArray(missionsData)
    ? missionsData.length
    : Array.isArray(missionsData?.missions)
      ? missionsData.missions.length
      : undefined;

  return {
    ...(balanceEuros !== undefined ? { balanceEuros } : {}),
    ...(balanceCents !== undefined ? { balanceCents } : {}),
    ...(loyaltyPoints !== undefined ? { loyaltyPoints } : {}),
    ...(acc.status || acc.tier ? { statusTier: String(acc.status || acc.tier) } : {}),
    ...(missionsCount !== undefined ? { missionsCount } : {}),
    raw: { balance: bal, account: acc, loyalty: loy, missions: missionsData },
  };
}

export function mapCoupon(raw: any): ReweCoupon {
  const c = raw?.coupon || raw || {};
  const status = c.status ? String(c.status) : undefined;
  const activated =
    c.activated !== undefined
      ? Boolean(c.activated)
      : c.isActivated !== undefined
        ? Boolean(c.isActivated)
        : status?.toUpperCase() === "ACTIVATED";

  return {
    id: String(c.id || c.couponId || ""),
    title: String(c.headline || c.title || c.name || "REWE Bonus Coupon"),
    ...(c.subheadline || c.subtitle
      ? { subtitle: String(c.subheadline || c.subtitle) }
      : {}),
    ...(c.description ? { description: String(c.description) } : {}),
    ...(c.discountText || c.incentiveText || c.value
      ? { discountText: String(c.discountText || c.incentiveText || c.value) }
      : {}),
    activated,
    ...(status ? { status } : {}),
    ...(c.validFrom ? { validFrom: String(c.validFrom) } : {}),
    ...(c.validUntil || c.validTo
      ? { validUntil: String(c.validUntil || c.validTo) }
      : {}),
    ...(c.imageUrl ? { imageUrl: String(c.imageUrl) } : {}),
    ...(c.conditions ? { conditions: String(c.conditions) } : {}),
  };
}

export function mapEbonSummary(raw: any): EbonSummary {
  const id = String(raw?.receiptId || raw?.id || "");
  const rawDate = String(raw?.receiptTimestamp || raw?.date || "");
  const ts = normalizeReweTimestamp(rawDate);

  const totalPrice =
    centsToEuros(raw?.receiptTotalPrice) ??
    parseGermanPrice(raw?.totalPrice) ??
    0;
  const bonusEarned =
    centsToEuros(raw?.bonusPriceInCent) ??
    parseGermanPrice(raw?.bonusPrice);

  const market = raw?.market || {};

  return {
    id,
    date: ts?.iso || rawDate,
    ...(ts?.localDate ? { localDate: ts.localDate } : {}),
    ...(market.wwIdent || market.id
      ? { marketId: String(market.wwIdent || market.id) }
      : {}),
    ...(market.name ? { marketName: String(market.name) } : {}),
    ...(market.street || market.streetWithNumber
      ? { marketStreet: String(market.street || market.streetWithNumber) }
      : {}),
    ...(market.zipCode ? { marketZipCode: String(market.zipCode) } : {}),
    ...(market.city ? { marketCity: String(market.city) } : {}),
    totalPrice,
    rawTotalPrice: formatEurString(totalPrice) || (raw?.totalPrice ? String(raw.totalPrice) : undefined),
    ...(bonusEarned !== undefined ? { bonusEarned } : {}),
    ...(raw?.bonusPrice ? { rawBonusEarned: String(raw.bonusPrice) } : {}),
    ...(raw?.payType ? { payType: String(raw.payType) } : {}),
    ...(raw?.cancelled !== undefined ? { cancelled: Boolean(raw.cancelled) } : {}),
  };
}

export function mapOrderSummary(raw: any): ReweOrderSummary {
  const id = String(raw?.orderId || raw?.id || "");
  const rawDate = raw?.orderDate || raw?.createdAt;
  const ts = normalizeReweTimestamp(rawDate);
  const totalPrice =
    centsToEuros(raw?.orderValue) ??
    parseGermanPrice(raw?.totalPrice);
  const firstSub = Array.isArray(raw?.subOrders) ? raw.subOrders[0] : undefined;

  const slot = firstSub?.timeSlot;
  const pickupOrDeliveryTime = slot?.firstSlotDate
    ? `${slot.firstSlotDate}${slot.lastSlotDate ? ` – ${slot.lastSlotDate}` : ""}`
    : undefined;

  return {
    id,
    ...(raw?.orderNumber ? { orderNumber: String(raw.orderNumber) } : {}),
    ...(raw?.status || firstSub?.status
      ? { status: String(raw?.status || firstSub?.status) }
      : {}),
    ...(ts?.iso || rawDate ? { createdAt: ts?.iso || String(rawDate) } : {}),
    ...(ts?.localDate ? { localDate: ts.localDate } : {}),
    ...(raw?.serviceType ? { serviceType: String(raw.serviceType) } : {}),
    ...(totalPrice !== undefined ? { totalPrice } : {}),
    ...(totalPrice !== undefined ? { rawTotalPrice: formatEurString(totalPrice) } : {}),
    ...(typeof raw?.itemCount === "number" ? { itemCount: raw.itemCount } : {}),
    ...(raw?.marketId ? { marketId: String(raw.marketId) } : {}),
    ...(pickupOrDeliveryTime ? { pickupOrDeliveryTime } : {}),
  };
}

export function mapOrderDetail(raw: any): ReweOrderDetail {
  const d = raw?.orderDetails || raw?.order || raw || {};
  const summary = mapOrderSummary(d);
  const items: ReweOrderLineItem[] = [];

  const subOrders = Array.isArray(d.subOrders) ? d.subOrders : [];
  for (const sub of subOrders) {
    const lineItems = Array.isArray(sub?.lineItems) ? sub.lineItems : [];
    for (const li of lineItems) {
      if (li?.lineItemType && !["PRODUCT", "ARTICLE", "ITEM"].includes(String(li.lineItemType).toUpperCase()) && !li.productId && !li.title) {
        continue;
      }
      if (!li?.title && !li?.name) continue;
      items.push({
        ...(li.id ? { id: String(li.id) } : {}),
        ...(li.productId ? { productId: String(li.productId) } : {}),
        ...(li.listingId ? { listingId: String(li.listingId) } : {}),
        ...(li.nan ? { nan: String(li.nan) } : {}),
        name: String(li.title || li.name),
        quantity: typeof li.quantity === "number" ? li.quantity : 1,
        ...(centsToEuros(li.price) !== undefined ? { unitPrice: centsToEuros(li.price) } : {}),
        ...(centsToEuros(li.totalPrice) !== undefined
          ? { totalPrice: centsToEuros(li.totalPrice) }
          : {}),
        ...(li.imageURL || li.imageUrl ? { imageUrl: String(li.imageURL || li.imageUrl) } : {}),
      });
    }
  }

  // Fallback for flat `items` or `lineItems` array
  const flatItems = Array.isArray(d.items) ? d.items : Array.isArray(d.lineItems) ? d.lineItems : [];
  for (const li of flatItems) {
    items.push({
      ...(li.id ? { id: String(li.id) } : {}),
      ...(li.productId ? { productId: String(li.productId) } : {}),
      ...(li.listingId ? { listingId: String(li.listingId) } : {}),
      ...(li.nan ? { nan: String(li.nan) } : {}),
      name: String(li.title || li.name || "Artikel"),
      quantity: typeof li.quantity === "number" ? li.quantity : 1,
      ...(centsToEuros(li.price) !== undefined ? { unitPrice: centsToEuros(li.price) } : {}),
      ...(centsToEuros(li.totalPrice) !== undefined
        ? { totalPrice: centsToEuros(li.totalPrice) }
        : {}),
    });
  }

  const articlesPrice = centsToEuros(d.articlesPrice);

  return {
    ...summary,
    itemCount: summary.itemCount ?? items.length,
    ...(articlesPrice !== undefined ? { articlesPrice } : {}),
    items,
    raw: d,
  };
}

export function mapFavoriteList(raw: any): FavoriteList {
  const list = raw || {};
  const rawItems: any[] = Array.isArray(list.items)
    ? list.items
    : Array.isArray(list.lineItems)
      ? list.lineItems
      : [];

  const items: FavoriteListItem[] = rawItems.map((it: any) => {
    const listing = it.listing || {};
    const price = centsToEuros(listing.currentRetailPrice) ?? parseGermanPrice(it.price);
    return {
      id: String(it.itemId || it.id || it.productId || ""),
      ...(it.itemId ? { itemId: String(it.itemId) } : {}),
      ...(listing.listingId || it.listingId
        ? { listingId: String(listing.listingId || it.listingId) }
        : {}),
      ...(it.productId ? { productId: String(it.productId) } : {}),
      ...(it.articleId ? { articleId: String(it.articleId) } : {}),
      ...(it.nan ? { nan: String(it.nan) } : {}),
      title: String(it.title || it.name || "Favorit"),
      ...(typeof it.quantity === "number" ? { quantity: it.quantity } : {}),
      ...(price !== undefined ? { price } : {}),
      ...(price !== undefined ? { rawPrice: formatEurString(price) } : {}),
      ...(listing.grammage || it.grammage
        ? { grammage: String(listing.grammage || it.grammage) }
        : {}),
      ...(it.imageURL || it.imageUrl
        ? { imageUrl: String(it.imageURL || it.imageUrl) }
        : {}),
    };
  });

  return {
    id: String(list.id || list.listId || "default"),
    ...(list.name ? { name: String(list.name) } : {}),
    itemCount: items.length,
    items,
  };
}

export function mapBasket(raw: any, marketConfig: MarketConfig): ReweBasket {
  const b = raw?.basket || raw || {};
  const lineItems: any[] = Array.isArray(b.lineItems) ? b.lineItems : [];

  const items: ReweBasketItem[] = lineItems.map((li: any) => {
    const p = li.product || {};
    const listing = p.listing || {};
    const unitPrice = centsToEuros(li.price ?? listing.currentRetailPrice);
    const totalPrice = centsToEuros(li.totalPrice);
    return {
      id: String(p.productId || listing.listingId || li.id || ""),
      ...(p.productId ? { productId: String(p.productId) } : {}),
      listingId: String(listing.listingId || li.listingId || ""),
      ...(p.nan ? { nan: String(p.nan) } : {}),
      title: String(p.title || li.title || "Artikel"),
      quantity: typeof li.quantity === "number" ? li.quantity : 1,
      ...(unitPrice !== undefined ? { unitPrice } : {}),
      ...(totalPrice !== undefined ? { totalPrice } : {}),
      ...(totalPrice !== undefined ? { rawTotalPrice: formatEurString(totalPrice) } : {}),
      ...(li.grammage || listing.grammage
        ? { grammage: String(li.grammage || listing.grammage) }
        : {}),
      ...(p.imageURL || p.imageUrl ? { imageUrl: String(p.imageURL || p.imageUrl) } : {}),
    };
  });

  const summary = b.summary || {};
  const totalPrice = centsToEuros(summary.totalPrice);
  const articlesPrice = centsToEuros(summary.articlePrice);
  const nextThreshold = b.staggerings?.nextStaggering?.articlePriceThreshold;
  const reachedThreshold = b.staggerings?.reachedStaggering?.articlePriceThreshold;
  const minimumOrderAmount =
    centsToEuros(b.serviceConfiguration?.minimumOrderAmount) ??
    centsToEuros(nextThreshold ?? reachedThreshold);
  const remainingForMinimum = centsToEuros(
    b.staggerings?.nextStaggering?.remainingArticlePrice
  );

  const serviceTypeRaw = b.serviceSelection?.serviceType || marketConfig.serviceType;
  const serviceType = serviceTypeRaw === "DELIVERY" ? "DELIVERY" : "PICKUP";

  return {
    id: String(b.id || ""),
    ...(typeof b.version === "number" ? { version: b.version } : {}),
    serviceType,
    marketId: String(b.serviceSelection?.wwIdent || marketConfig.marketId),
    zipCode: String(b.serviceSelection?.zipCode || marketConfig.zipCode),
    itemCount:
      typeof summary.articleCount === "number" ? summary.articleCount : items.length,
    totalQuantity:
      typeof summary.totalArticleQuantity === "number"
        ? summary.totalArticleQuantity
        : items.reduce((acc, item) => acc + item.quantity, 0),
    ...(articlesPrice !== undefined ? { articlesPrice } : {}),
    ...(totalPrice !== undefined ? { totalPrice } : {}),
    ...(totalPrice !== undefined ? { rawTotalPrice: formatEurString(totalPrice) } : {}),
    ...(minimumOrderAmount !== undefined ? { minimumOrderValue: minimumOrderAmount } : {}),
    ...(remainingForMinimum !== undefined
      ? {
          minimumOrderReached: remainingForMinimum <= 0,
          remainingForMinimum,
        }
      : { minimumOrderReached: !(Array.isArray(b.violations) && b.violations.some((v: any) => String(v.id || "").includes("minimum"))) }),
    ...(b.timeSlotInformation?.timeSlotText
      ? { timeslotText: String(b.timeSlotInformation.timeSlotText) }
      : {}),
    items,
  };
}

export function mapTimeslot(raw: any): Timeslot {
  const start = String(raw?.startTime || raw?.start || "");
  const end = String(raw?.endTime || raw?.end || "");
  const startTs = normalizeReweTimestamp(start);
  const endTs = normalizeReweTimestamp(end);
  const price = centsToEuros(raw?.serviceFee ?? raw?.price);

  const timeRange =
    startTs && endTs
      ? `${startTs.iso.slice(11, 16)}–${endTs.iso.slice(11, 16)}`
      : undefined;

  return {
    id: String(raw?.id || raw?.slotId || ""),
    start: startTs?.iso || start,
    end: endTs?.iso || end,
    ...(startTs?.localDate ? { date: startTs.localDate } : {}),
    ...(timeRange ? { formattedTime: timeRange } : {}),
    ...(price !== undefined ? { price } : {}),
    ...(price !== undefined ? { rawPrice: formatEurString(price) } : {}),
    available: raw?.available !== undefined ? Boolean(raw.available) : true,
    ...(raw?.type ? { type: String(raw.type) } : {}),
  };
}
