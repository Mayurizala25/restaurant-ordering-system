"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  type DemoCategory,
  type DemoMenuItem,
  type DemoTable,
} from "../admin/_lib/demo-data";
import CustomerThemeToggle from "../customer/customer-theme-toggle";

const CART_STORAGE_KEY = "virtual-rudra.order.cart";
const CUSTOMER_DETAILS_STORAGE_KEY = "virtual-rudra.customer.details";
const ORDER_CONFIRMATION_STORAGE_KEY = "virtual-rudra.order.confirmation";
const PENDING_ORDER_REQUEST_STORAGE_KEY = "virtual-rudra.order.pending-request";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ORDER_QUANTITY = 99;
const MAX_ORDER_LINES = 50;
const MAX_SPECIAL_INSTRUCTIONS = 500;
const VEGETARIAN_ITEM_IDS = new Set([
  "item-paneer-tikka",
  "item-samosa",
  "item-paneer-butter-masala",
  "item-dal-makhani",
  "item-garlic-naan",
  "item-jeera-rice",
  "item-gulab-jamun",
  "item-masala-chai",
]);
const SPECIAL_ITEM_IDS = new Set([
  "item-paneer-tikka",
  "item-butter-chicken",
  "item-paneer-butter-masala",
]);
const formatINR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

type MenuData = {
  categories: DemoCategory[];
  menuItems: DemoMenuItem[];
  tables: DemoTable[];
  taxRatePercent: number;
};

type SpiceLevel = "Mild" | "Medium" | "Spicy";
type CartLine = {
  itemId: string;
  quantity: number;
  spiceLevel: SpiceLevel;
  specialInstructions: string;
};
type HeroSlide = {
  id: string;
  kicker: string;
  title: string;
  description: string;
  imageUrl: string;
};
type StorefrontPage = "menu" | "cart" | "checkout" | "thank-you";
type MenuFilter = "all" | "vegetarian" | "special";
type OrderConfirmation = {
  id: string;
  trackingToken: string;
  customerName: string;
  customerPhone: string;
  customerDetailsSaveNotice?: string;
  tableNumber: number;
  items: {
    itemId: string;
    name: string;
    quantity: number;
    unitPrice: number;
    spiceLevel?: SpiceLevel;
    specialInstructions?: string;
  }[];
  subtotal?: number;
  discountAmount?: number;
  couponCode?: string | null;
  taxRatePercent?: number;
  taxAmount?: number;
  total: number;
};

function isOrderConfirmation(value: unknown): value is OrderConfirmation {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.trackingToken === "string" &&
    /^[0-9a-f]{64}$/.test(value.trackingToken) &&
    typeof value.customerName === "string" &&
    typeof value.customerPhone === "string" &&
    (value.customerDetailsSaveNotice === undefined ||
      typeof value.customerDetailsSaveNotice === "string") &&
    Number.isSafeInteger(value.tableNumber) &&
    Array.isArray(value.items) &&
    value.items.length > 0 &&
    value.items.every(
      (item) =>
        isRecord(item) &&
        typeof item.itemId === "string" &&
        typeof item.name === "string" &&
        Number.isSafeInteger(item.quantity) &&
        typeof item.unitPrice === "number" &&
        Number.isFinite(item.unitPrice) &&
        item.unitPrice >= 0 &&
        (item.spiceLevel === undefined || isSpiceLevel(item.spiceLevel)) &&
        (item.specialInstructions === undefined ||
          (typeof item.specialInstructions === "string" &&
            item.specialInstructions.length <= MAX_SPECIAL_INSTRUCTIONS)),
    ) &&
    (value.subtotal === undefined ||
      (typeof value.subtotal === "number" &&
        Number.isFinite(value.subtotal) &&
        value.subtotal >= 0)) &&
    (value.discountAmount === undefined ||
      (typeof value.discountAmount === "number" &&
        Number.isFinite(value.discountAmount) &&
        value.discountAmount >= 0)) &&
    (value.couponCode === undefined ||
      value.couponCode === null ||
      (typeof value.couponCode === "string" &&
        value.couponCode.length > 0 &&
        value.couponCode.length <= 32)) &&
    (value.taxRatePercent === undefined ||
      (typeof value.taxRatePercent === "number" &&
        Number.isFinite(value.taxRatePercent) &&
        value.taxRatePercent >= 0 &&
        value.taxRatePercent <= 100)) &&
    (value.taxAmount === undefined ||
      (typeof value.taxAmount === "number" &&
        Number.isFinite(value.taxAmount) &&
        value.taxAmount >= 0)) &&
    typeof value.total === "number" &&
    Number.isFinite(value.total) &&
    value.total >= 0
  );
}

type OrderRequest = {
  customerName: string;
  customerPhone: string;
  tableNumber: number;
  requestId: string;
  items: CartLine[];
};

function isSpiceLevel(value: unknown): value is SpiceLevel {
  return value === "Mild" || value === "Medium" || value === "Spicy";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStoredCustomerDetails(
  value: unknown,
): value is { version: 1; name: string; phone: string } {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    value.name.length <= 100 &&
    typeof value.phone === "string" &&
    /^\+?[0-9][0-9 ()-]{5,18}[0-9]$/.test(value.phone) &&
    value.phone.replace(/\D/g, "").length >= 7 &&
    value.phone.replace(/\D/g, "").length <= 15
  );
}

function calculateTaxAmount(subtotal: number, taxRatePercent: number) {
  return Math.round(Math.round(subtotal * 100) / 100 * taxRatePercent) / 100;
}

function isStoredCartLine(
  value: unknown,
): value is Omit<CartLine, "spiceLevel" | "specialInstructions"> &
  Partial<Pick<CartLine, "spiceLevel" | "specialInstructions">> {
  return (
    isRecord(value) &&
    typeof value.itemId === "string" &&
    value.itemId.length > 0 &&
    value.itemId.length <= 128 &&
    typeof value.quantity === "number" &&
    Number.isSafeInteger(value.quantity) &&
    value.quantity >= 1 &&
    value.quantity <= MAX_ORDER_QUANTITY &&
    (value.spiceLevel === undefined || isSpiceLevel(value.spiceLevel)) &&
    (value.specialInstructions === undefined ||
      (typeof value.specialInstructions === "string" &&
        value.specialInstructions.length <= MAX_SPECIAL_INSTRUCTIONS))
  );
}

function isCategory(value: unknown): value is DemoCategory {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    typeof value.imageUrl === "string" &&
    typeof value.isActive === "boolean" &&
    Number.isSafeInteger(value.sortOrder)
  );
}

function isMenuItem(value: unknown): value is DemoMenuItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    typeof value.priceINR === "number" &&
    Number.isFinite(value.priceINR) &&
    value.priceINR >= 0 &&
    typeof value.imageUrl === "string" &&
    typeof value.categoryId === "string" &&
    typeof value.isAvailable === "boolean"
  );
}

function isTable(value: unknown): value is DemoTable {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.trim().length > 0 &&
    typeof value.tableNumber === "number" &&
    Number.isSafeInteger(value.tableNumber) &&
    value.tableNumber > 0 &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    value.name.length <= 60 &&
    typeof value.seatingCapacity === "number" &&
    Number.isSafeInteger(value.seatingCapacity) &&
    value.seatingCapacity > 0 &&
    typeof value.isActive === "boolean"
  );
}

function parseTableNumber(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const tableNumber = Number(value);
  return Number.isSafeInteger(tableNumber) && tableNumber > 0
    ? tableNumber
    : null;
}

function readCart(): CartLine[] {
  let serialized: string | null;
  try {
    serialized = window.localStorage.getItem(CART_STORAGE_KEY);
  } catch (cause) {
    throw new Error("Your cart could not be read from this browser.", { cause });
  }

  if (serialized === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (cause) {
    throw new Error("Your saved cart is not valid JSON.", { cause });
  }

  if (!Array.isArray(parsed) || parsed.length > MAX_ORDER_LINES) {
    throw new Error("Your saved cart is invalid. Add the items again to continue.");
  }
  if (!parsed.every(isStoredCartLine)) {
    throw new Error("Your saved cart is invalid. Add the items again to continue.");
  }
  if (new Set(parsed.map((line) => line.itemId)).size !== parsed.length) {
    throw new Error("Your saved cart contains duplicate items. Add them again to continue.");
  }

  return parsed.map((line) => ({
    ...line,
    spiceLevel: line.spiceLevel ?? "Mild",
    specialInstructions: line.specialInstructions ?? "",
  }));
}

function createOrderRequestId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  if (typeof cryptoApi?.getRandomValues !== "function") {
    throw new Error("Secure random ID generation is unavailable in this browser.");
  }

  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function createOrderRequestKey(request: Omit<OrderRequest, "requestId">) {
  const serializedRequest = JSON.stringify(request);
  const subtle = globalThis.crypto?.subtle;
  if (typeof subtle?.digest === "function" && typeof TextEncoder !== "undefined") {
    const digest = await subtle.digest(
      "SHA-256",
      new TextEncoder().encode(serializedRequest),
    );
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  }

  // This local-only key matches retries; the API still validates a random UUID.
  const hash = (seed: number, multiplier: number) => {
    let value = seed;
    for (let index = 0; index < serializedRequest.length; index += 1) {
      value = Math.imul(
        value ^ serializedRequest.charCodeAt(index),
        multiplier,
      );
    }
    return (value >>> 0).toString(16).padStart(8, "0");
  };
  return [
    hash(0x811c9dc5, 0x01000193),
    hash(0x9e3779b9, 0x85ebca6b),
    hash(0x243f6a88, 0xc2b2ae35),
    hash(0xb7e15162, 0x27d4eb2f),
  ].join("");
}

function getPendingOrderRequest(key: string) {
  const stored = window.sessionStorage.getItem(
    PENDING_ORDER_REQUEST_STORAGE_KEY,
  );
  if (stored) {
    let value: unknown;
    try {
      value = JSON.parse(stored);
    } catch (cause) {
      throw new Error("A previous order retry could not be verified.", { cause });
    }
    if (
      !isRecord(value) ||
      typeof value.key !== "string" ||
      typeof value.requestId !== "string" ||
      !UUID_PATTERN.test(value.requestId)
    ) {
      throw new Error("A previous order retry could not be verified.");
    }
    if (value.key !== key) {
      throw new Error(
        "A previous order is still awaiting confirmation. Restore the same checkout details and cart, then retry before changing them.",
      );
    }
    return { key, requestId: value.requestId };
  }

  const pendingRequest = { key, requestId: createOrderRequestId() };
  window.sessionStorage.setItem(
    PENDING_ORDER_REQUEST_STORAGE_KEY,
    JSON.stringify(pendingRequest),
  );
  return pendingRequest;
}

export default function MenuClient({ page = "menu" }: { page?: StorefrontPage }) {
  const router = useRouter();
  const [data, setData] = useState<MenuData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [menuRetryCount, setMenuRetryCount] = useState(0);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [menuFilter, setMenuFilter] = useState<MenuFilter>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [heroSlideIndex, setHeroSlideIndex] = useState(0);
  const [selectedDish, setSelectedDish] = useState<DemoMenuItem | null>(null);
  const [customizationQuantity, setCustomizationQuantity] = useState(1);
  const [customizationSpiceLevel, setCustomizationSpiceLevel] =
    useState<SpiceLevel>("Mild");
  const [customizationInstructions, setCustomizationInstructions] = useState("");
  const dishDetailsRef = useRef<HTMLDialogElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const heroPointerStart = useRef<number | null>(null);
  const [tableId, setTableId] = useState<string | null>(null);
  const [qrTableNumber, setQrTableNumber] = useState<number | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartStorageError, setCartStorageError] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerDetailsNotice, setCustomerDetailsNotice] = useState("");
  const [checkoutTableNumber, setCheckoutTableNumber] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [appliedCouponCode, setAppliedCouponCode] = useState<string | null>(null);
  const [couponDiscountAmount, setCouponDiscountAmount] = useState(0);
  const [couponMessage, setCouponMessage] = useState("");
  const [isApplyingCoupon, setIsApplyingCoupon] = useState(false);
  const [checkoutMessage, setCheckoutMessage] = useState("");
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const submissionLock = useRef(false);
  const customerDetailsLoaded = useRef(false);
  const [orderConfirmation, setOrderConfirmation] = useState<OrderConfirmation | null>(null);
  const pendingOrderRequest = useRef<{ key: string; requestId: string } | null>(null);
  const [confirmationReady, setConfirmationReady] = useState(page !== "thank-you");
  const [confirmationError, setConfirmationError] = useState("");
  const [feedbackRating, setFeedbackRating] = useState(0);
  const [feedbackComment, setFeedbackComment] = useState("");
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackError, setFeedbackError] = useState("");
  const recordedQrScans = useRef(new Set<string>());

  useEffect(() => {
    const dialog = dishDetailsRef.current;
    if (!dialog) return;
    if (selectedDish && !dialog.open) dialog.showModal();
    if (!selectedDish && dialog.open) dialog.close();
  }, [selectedDish]);

  useEffect(() => {
    let active = true;
    let latestMenuRequest = 0;
    const refreshMenu = async () => {
      const requestId = ++latestMenuRequest;
      try {
        const response = await fetch("/api/menu", {
          cache: "no-store",
          signal: AbortSignal.timeout(12_000),
        });
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          payload = null;
        }
        if (!response.ok) {
          const message =
            isRecord(payload) && typeof payload.error === "string"
              ? payload.error
              : "Could not load the restaurant menu.";
          throw new Error(message);
        }
        if (
          !isRecord(payload) ||
          !Array.isArray(payload.categories) ||
          !payload.categories.every(isCategory) ||
          !Array.isArray(payload.menuItems) ||
          !payload.menuItems.every(isMenuItem) ||
          !Array.isArray(payload.tables) ||
          !payload.tables.every(isTable) ||
          typeof payload.taxRatePercent !== "number" ||
          !Number.isFinite(payload.taxRatePercent) ||
          payload.taxRatePercent < 0 ||
          payload.taxRatePercent > 100
        ) {
          throw new Error("The restaurant menu response could not be read.");
        }
        const categoryIds = new Set(
          payload.categories.map((category) => category.id),
        );
        if (
          !payload.menuItems.every((item) => categoryIds.has(item.categoryId))
        ) {
          throw new Error("The restaurant menu contains an unknown category.");
        }
        if (!active || requestId !== latestMenuRequest) return;
        setData({
          categories: payload.categories,
          menuItems: payload.menuItems,
          tables: payload.tables,
          taxRatePercent: payload.taxRatePercent,
        });
        setLoadError("");
      } catch (cause) {
        if (!active || requestId !== latestMenuRequest) return;
        setData(null);
        setLoadError(
          cause instanceof TypeError
            ? "Could not load the menu. Check your connection and try again."
            : cause instanceof Error
              ? cause.message
              : "Could not load the restaurant menu.",
        );
      }
    };

    const recordTableQrScan = (tableId: string | null) => {
      if (!tableId || !UUID_PATTERN.test(tableId) || recordedQrScans.current.has(tableId)) {
        return;
      }
      recordedQrScans.current.add(tableId);
      void fetch("/api/qr-scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ tableId, qrType: "table_menu" }),
      }).then(async (response) => {
        if (response.ok) return;
        const payload: unknown = await response.json().catch(() => null);
        throw new Error(
          isRecord(payload) && typeof payload.error === "string"
            ? payload.error
            : "Could not record this QR scan.",
        );
      }).catch((cause: unknown) => {
        console.error("QR scan analytics could not be recorded.", cause);
      });
    };

    const initializeTimer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const scannedTableId = params.get("tableId");
      setTableId(scannedTableId);
      setQrTableNumber(parseTableNumber(params.get("tableNumber")));
      recordTableQrScan(scannedTableId);
      void refreshMenu();
      if (page === "checkout" && !customerDetailsLoaded.current) {
        customerDetailsLoaded.current = true;
        try {
          const serializedDetails = window.localStorage.getItem(
            CUSTOMER_DETAILS_STORAGE_KEY,
          );
          if (serializedDetails) {
            const savedDetails: unknown = JSON.parse(serializedDetails);
            if (!isStoredCustomerDetails(savedDetails)) {
              throw new Error("Saved customer details are invalid.");
            }
            setCustomerName(savedDetails.name);
            setCustomerPhone(savedDetails.phone);
          }
        } catch (cause) {
          setCustomerDetailsNotice(
            cause instanceof Error
              ? `Saved details could not be loaded: ${cause.message}`
              : "Saved details could not be loaded from this browser.",
          );
        }
      }
      if (page === "thank-you") {
        try {
          const serializedOrder = window.sessionStorage.getItem(
            ORDER_CONFIRMATION_STORAGE_KEY,
          );
          const savedOrder: unknown = serializedOrder
            ? JSON.parse(serializedOrder)
            : null;
          if (isOrderConfirmation(savedOrder)) {
            setOrderConfirmation(savedOrder);
          } else {
            setConfirmationError("No recent confirmed order was found in this browser.");
          }
        } catch (cause) {
          setConfirmationError(
            cause instanceof Error
              ? `The order confirmation could not be loaded: ${cause.message}`
              : "The order confirmation could not be loaded from this browser.",
          );
        } finally {
          setConfirmationReady(true);
        }
      }
      try {
        setCart(readCart());
        setCartStorageError("");
      } catch (cause) {
        setCartStorageError(
          cause instanceof Error ? cause.message : "Your cart could not be restored.",
        );
      }
    }, 0);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refreshMenu();
    };
    const handleFocus = () => void refreshMenu();
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const scannedTableId = params.get("tableId");
      setTableId(scannedTableId);
      setQrTableNumber(parseTableNumber(params.get("tableNumber")));
      recordTableQrScan(scannedTableId);
    };
    window.addEventListener("focus", handleFocus);
    window.addEventListener("virtual-rudra:refresh", handleFocus);
    window.addEventListener("popstate", handlePopState);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.clearTimeout(initializeTimer);
      active = false;
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("virtual-rudra:refresh", handleFocus);
      window.removeEventListener("popstate", handlePopState);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [menuRetryCount, page]);

  const updateCart = (nextCart: CartLine[]) => {
    setCart(nextCart);
    try {
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(nextCart));
      setCartStorageError("");
    } catch {
      setCartStorageError("Your cart could not be saved in this browser.");
    }
  };

  const categories = useMemo(
    () => (data?.categories ?? []).toSorted((left, right) => left.sortOrder - right.sortOrder),
    [data],
  );
  const itemCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of data?.menuItems ?? []) {
      counts.set(item.categoryId, (counts.get(item.categoryId) ?? 0) + 1);
    }
    return counts;
  }, [data]);
  const groups = useMemo(() => {
    if (!data) return [];
    const query = search.trim().toLocaleLowerCase();
    return categories
      .filter(
        (category) =>
          selectedCategory === "all" || category.id === selectedCategory,
      )
      .map((category) => ({
        category,
        items: data.menuItems.filter((item) => {
          if (item.categoryId !== category.id) return false;
          if (menuFilter === "vegetarian" && !VEGETARIAN_ITEM_IDS.has(item.id)) {
            return false;
          }
          if (menuFilter === "special" && !SPECIAL_ITEM_IDS.has(item.id)) {
            return false;
          }
          if (!query) return true;
          return (
            item.name.toLocaleLowerCase().includes(query) ||
            item.description.toLocaleLowerCase().includes(query) ||
            category.name.toLocaleLowerCase().includes(query)
          );
        }),
      }))
      .filter((group) => group.items.length > 0);
  }, [categories, data, menuFilter, search, selectedCategory]);
  const heroSlides = useMemo<HeroSlide[]>(() => {
    const heroImage = "/brand/virtual-rudra-awadhi-hero.jpg";
    const featuredItems = (data?.menuItems ?? [])
      .filter(
        (item) =>
          item.isAvailable &&
          item.imageUrl.trim().length > 0 &&
          item.imageUrl.trim() !== heroImage,
      )
      .slice(0, 3);

    return [
      {
        id: "signature-biryani",
        kicker: "AUTHENTIC TASTE",
        title: "Awadhi Biryani",
        description: "A royal feast in every bite.",
        imageUrl: heroImage,
      },
      ...featuredItems.map((item) => ({
        id: item.id,
        kicker: "FRESH FROM OUR KITCHEN",
        title: item.name,
        description: item.description,
        imageUrl: item.imageUrl.trim(),
      })),
    ];
  }, [data]);

  const resultCount = groups.reduce((count, group) => count + group.items.length, 0);
  const activeHeroSlideIndex = heroSlideIndex % heroSlides.length;
  const activeHeroSlide = heroSlides[activeHeroSlideIndex] ?? heroSlides[0];
  const heroTitleWords = activeHeroSlide.title.trim().split(/\s+/);
  const heroTitleAccent = heroTitleWords.pop() ?? activeHeroSlide.title;
  const heroTitleLead = heroTitleWords.join(" ");

  useEffect(() => {
    if (
      page !== "menu" ||
      heroSlides.length < 2 ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const timer = window.setInterval(() => {
      setHeroSlideIndex((current) => (current + 1) % heroSlides.length);
    }, 5600);
    return () => window.clearInterval(timer);
  }, [heroSlides.length, page]);

  const cartItems = cart.map(({ itemId, quantity }) => {
    const item = data?.menuItems.find((menuItem) => menuItem.id === itemId);
    return {
      item: item ?? {
        id: itemId,
        name: "Unavailable item",
        description: "This item is no longer on the menu.",
        priceINR: 0,
        imageUrl: "",
        categoryId: "",
        isAvailable: false,
      },
      quantity,
      isUnavailable: !item || !item.isAvailable,
    };
  });
  const hasUnavailableItems = cartItems.some((line) => line.isUnavailable);
  const cartItemCount = cartItems.reduce((count, line) => count + line.quantity, 0);
  const confirmedItemCount =
    orderConfirmation?.items.reduce((count, item) => count + item.quantity, 0) ?? 0;
  const subtotal =
    Math.round(
      cartItems.reduce(
        (total, line) =>
          total + (line.isUnavailable ? 0 : line.item.priceINR * line.quantity),
        0,
      ) * 100,
    ) / 100;
  const checkoutSubtotal = orderConfirmation?.subtotal ?? subtotal;
  const checkoutDiscountAmount =
    orderConfirmation?.discountAmount ?? couponDiscountAmount;
  const checkoutCouponCode =
    orderConfirmation?.couponCode ?? appliedCouponCode;
  const checkoutTaxableAmount =
    Math.round(Math.max(0, checkoutSubtotal - checkoutDiscountAmount) * 100) / 100;
  const checkoutTaxRatePercent =
    orderConfirmation?.taxRatePercent ?? data?.taxRatePercent ?? 0;
  const checkoutTaxAmount =
    orderConfirmation?.taxAmount ??
    calculateTaxAmount(checkoutTaxableAmount, checkoutTaxRatePercent);
  const checkoutTotal =
    orderConfirmation?.total ??
    Math.round((checkoutTaxableAmount + checkoutTaxAmount) * 100) / 100;
  const selectedTable = data?.tables.find((table) => table.id === tableId);
  const tableNumber = selectedTable?.tableNumber ?? null;
  const tableNumberMismatch =
    tableId !== null &&
    data !== null &&
    qrTableNumber !== null &&
    (selectedTable === undefined || qrTableNumber !== selectedTable.tableNumber);
  const tableQuery = new URLSearchParams();
  if (tableId) tableQuery.set("tableId", tableId);
  if (tableNumber !== null) tableQuery.set("tableNumber", String(tableNumber));
  const tableQueryString = tableQuery.toString();
  const tableQuerySuffix = tableQueryString ? `?${tableQueryString}` : "";
  const tableHref = (path: string) => `${path}${tableQuerySuffix}`;
  const focusMenuSearch = () => {
    const input = searchInputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    input.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const showHeroSlide = (direction: -1 | 1) => {
    setHeroSlideIndex(
      (current) => (current + direction + heroSlides.length) % heroSlides.length,
    );
  };

  const openDishCustomization = (item: DemoMenuItem) => {
    if (!item.isAvailable || isSubmittingOrder) return;
    const existingLine = cart.find((line) => line.itemId === item.id);
    setCustomizationQuantity(existingLine?.quantity ?? 1);
    setCustomizationSpiceLevel(existingLine?.spiceLevel ?? "Mild");
    setCustomizationInstructions(existingLine?.specialInstructions ?? "");
    setSelectedDish(item);
  };
  const saveDishCustomization = () => {
    if (!selectedDish?.isAvailable || isSubmittingOrder) return;
    submissionLock.current = false;
    setOrderConfirmation(null);
    const existingLine = cart.find((line) => line.itemId === selectedDish.id);
    if (
      (existingLine && !Number.isSafeInteger(customizationQuantity)) ||
      customizationQuantity < 1 ||
      customizationQuantity > MAX_ORDER_QUANTITY ||
      (!existingLine && cart.length >= MAX_ORDER_LINES)
    ) {
      return;
    }
    updateCart(
      existingLine
        ? cart.map((line) =>
            line.itemId === selectedDish.id
              ? {
                  ...line,
                  quantity: customizationQuantity,
                  spiceLevel: customizationSpiceLevel,
                  specialInstructions: customizationInstructions.trim(),
                }
              : line,
          )
        : [
            ...cart,
            {
              itemId: selectedDish.id,
              quantity: customizationQuantity,
              spiceLevel: customizationSpiceLevel,
              specialInstructions: customizationInstructions.trim(),
            },
          ],
    );
    setSelectedDish(null);
  };
  const changeCartQuantity = (itemId: string, change: number) => {
    if (isSubmittingOrder) return;
    const item = data?.menuItems.find((menuItem) => menuItem.id === itemId);
    if (change > 0 && !item?.isAvailable) return;
    const currentLine = cart.find((line) => line.itemId === itemId);
    if (change > 0 && currentLine && currentLine.quantity >= MAX_ORDER_QUANTITY) return;
    submissionLock.current = false;
    setOrderConfirmation(null);
    updateCart(
      cart.flatMap((line) => {
        if (line.itemId !== itemId) return [line];
        const quantity = line.quantity + change;
        return quantity > 0 ? [{ ...line, quantity }] : [];
      }),
    );
  };
  const removeFromCart = (itemId: string) => {
    if (isSubmittingOrder) return;
    submissionLock.current = false;
    setOrderConfirmation(null);
    updateCart(cart.filter((line) => line.itemId !== itemId));
  };
  const applyCoupon = async () => {
    if (!couponCode.trim() || cartItems.length === 0) return;
    setIsApplyingCoupon(true);
    setCouponMessage("");
    try {
      const response = await fetch("/api/coupons/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ code: couponCode.trim(), subtotal }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (
        !response.ok ||
        !isRecord(payload) ||
        typeof payload.couponCode !== "string" ||
        typeof payload.discountAmount !== "number" ||
        !Number.isFinite(payload.discountAmount) ||
        payload.discountAmount < 0
      ) {
        setAppliedCouponCode(null);
        setCouponDiscountAmount(0);
        setCouponMessage(
          isRecord(payload) && typeof payload.error === "string"
            ? payload.error
            : "Coupon could not be applied.",
        );
        return;
      }
      setAppliedCouponCode(payload.couponCode);
      setCouponDiscountAmount(payload.discountAmount);
      setCouponCode(payload.couponCode);
      setCouponMessage(
        `Coupon ${payload.couponCode} applied · ${formatINR.format(payload.discountAmount)} off`,
      );
    } catch {
      setCouponMessage("Coupon could not be applied. Try again.");
    } finally {
      setIsApplyingCoupon(false);
    }
  };

  const handleCheckout = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submissionLock.current || orderConfirmation) return;
    if (cartItems.length === 0) {
      setCheckoutMessage("Add at least one item to your cart before placing an order.");
      return;
    }
    if (isSubmittingOrder) return;

    const parsedTableNumber = Number(tableNumber ?? checkoutTableNumber);
    const orderTable = data?.tables.find(
      (table) => table.tableNumber === parsedTableNumber && table.isActive,
    );
    const cartIsValid =
      data !== null &&
      cart.length > 0 &&
      cartItems.length === cart.length &&
      cartItems.every(({ item, isUnavailable }) => item.isAvailable && !isUnavailable);
    if (
      !cartIsValid ||
      !customerName.trim() ||
      customerName.trim().length > 100 ||
      !/^\+?[0-9][0-9 ()-]{5,18}[0-9]$/.test(customerPhone.trim()) ||
      customerPhone.replace(/\D/g, "").length < 7 ||
      customerPhone.replace(/\D/g, "").length > 15 ||
      !Number.isSafeInteger(parsedTableNumber) ||
      !orderTable ||
      tableNumberMismatch ||
      (tableId !== null &&
        (!selectedTable || selectedTable.tableNumber !== parsedTableNumber))
    ) {
      setCheckoutMessage(
        !cartIsValid
          ? "Your cart contains an unavailable item. Remove it and try again."
          : "Enter a valid name, phone number, and active table number.",
      );
      return;
    }

    submissionLock.current = true;
    setIsSubmittingOrder(true);
    setCheckoutMessage("");

    const request: Omit<OrderRequest, "requestId"> = {
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim(),
      tableNumber: parsedTableNumber,
      items: cart.map(
        ({ itemId, quantity, spiceLevel, specialInstructions }) => ({
          itemId,
          quantity,
          spiceLevel,
          specialInstructions,
        }),
      ),
    };
    let requestKey: string;
    try {
      requestKey = await createOrderRequestKey(request);
      pendingOrderRequest.current =
        pendingOrderRequest.current?.key === requestKey
          ? pendingOrderRequest.current
          : getPendingOrderRequest(requestKey);
    } catch (cause) {
      submissionLock.current = false;
      setIsSubmittingOrder(false);
      setCheckoutMessage(
        cause instanceof Error
          ? cause.message
          : "Could not prepare a safe order retry. Please try again.",
      );
      return;
    }

    let response: Response;
    try {
      response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...request,
          requestId: pendingOrderRequest.current.requestId,
          couponCode: appliedCouponCode,
        }),
      });
    } catch {
      submissionLock.current = false;
      setIsSubmittingOrder(false);
      setCheckoutMessage("Could not reach the order service. Check your connection and retry.");
      return;
    }

    let result: unknown;
    try {
      result = await response.json();
    } catch {
      submissionLock.current = false;
      setIsSubmittingOrder(false);
      setCheckoutMessage("The order service returned an unreadable response. Retry your order.");
      return;
    }
    if (
      !response.ok ||
      !isRecord(result) ||
      typeof result.orderId !== "string" ||
      result.orderId.length === 0 ||
      typeof result.trackingToken !== "string" ||
      !/^[0-9a-f]{64}$/.test(result.trackingToken) ||
      typeof result.total !== "number" ||
      !Number.isFinite(result.total) ||
      result.total < 0 ||
      typeof result.subtotal !== "number" ||
      !Number.isFinite(result.subtotal) ||
      result.subtotal < 0 ||
      typeof result.taxRatePercent !== "number" ||
      !Number.isFinite(result.taxRatePercent) ||
      result.taxRatePercent < 0 ||
      result.taxRatePercent > 100 ||
      typeof result.taxAmount !== "number" ||
      !Number.isFinite(result.taxAmount) ||
      result.taxAmount < 0 ||
      typeof result.discountAmount !== "number" ||
      !Number.isFinite(result.discountAmount) ||
      result.discountAmount < 0 ||
      (result.couponCode !== null &&
        (typeof result.couponCode !== "string" ||
          result.couponCode.length < 1 ||
          result.couponCode.length > 32)) ||
      Math.round(
        (result.subtotal - result.discountAmount + result.taxAmount) * 100,
      ) !==
        Math.round(result.total * 100)
    ) {
      submissionLock.current = false;
      setIsSubmittingOrder(false);
      const errorMessage =
        isRecord(result) && typeof result.error === "string"
          ? result.error
          : "The order could not be confirmed. Please retry.";
      if ([400, 403, 413, 415, 422].includes(response.status)) {
        try {
          window.sessionStorage.removeItem(PENDING_ORDER_REQUEST_STORAGE_KEY);
          pendingOrderRequest.current = null;
        } catch {
          setCheckoutMessage(
            `${errorMessage} The retry state could not be cleared, so keep the same checkout details and cart before retrying.`,
          );
          return;
        }
      }
      setCheckoutMessage(
        errorMessage,
      );
      return;
    }

    let customerDetailsSaveNotice: string | undefined;
    try {
      window.localStorage.setItem(
        CUSTOMER_DETAILS_STORAGE_KEY,
        JSON.stringify({
          version: 1,
          name: request.customerName,
          phone: request.customerPhone,
        }),
      );
      setCustomerDetailsNotice("");
    } catch (cause) {
      customerDetailsSaveNotice =
        "Your order is confirmed, but your details could not be saved in this browser for next time.";
      console.error("Customer details could not be saved for checkout autofill.", cause);
    }

    const order: OrderConfirmation = {
      id: result.orderId,
      trackingToken: result.trackingToken,
      customerName: request.customerName,
      customerPhone: request.customerPhone,
      ...(customerDetailsSaveNotice ? { customerDetailsSaveNotice } : {}),
      tableNumber: request.tableNumber,
      items: cartItems.map(({ item, quantity }) => ({
        itemId: item.id,
        name: item.name,
        quantity,
        unitPrice: item.priceINR,
        spiceLevel: cart.find((line) => line.itemId === item.id)?.spiceLevel ?? "Mild",
        specialInstructions:
          cart.find((line) => line.itemId === item.id)?.specialInstructions ?? "",
      })),
      subtotal: result.subtotal,
      discountAmount: result.discountAmount,
      couponCode:
        typeof result.couponCode === "string" ? result.couponCode : null,
      taxRatePercent: result.taxRatePercent,
      taxAmount: result.taxAmount,
      total: result.total,
    };
    try {
      window.sessionStorage.setItem(
        ORDER_CONFIRMATION_STORAGE_KEY,
        JSON.stringify(order),
      );
      window.sessionStorage.removeItem(PENDING_ORDER_REQUEST_STORAGE_KEY);
    } catch {
      pendingOrderRequest.current = null;
      updateCart([]);
      setIsSubmittingOrder(false);
      router.push(`/track/${order.trackingToken}`);
      return;
    }
    pendingOrderRequest.current = null;
    updateCart([]);
    setOrderConfirmation(order);
    setIsSubmittingOrder(false);
    router.push(tableHref("/thank-you"));
  };

  async function handleFeedbackSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedbackMessage("");
    setFeedbackError("");
    if (!orderConfirmation || feedbackRating < 1 || feedbackRating > 5) {
      setFeedbackError("Choose a rating from 1 to 5 stars.");
      return;
    }
    if (feedbackComment.trim().length > 1000) {
      setFeedbackError("Your comment must be 1000 characters or fewer.");
      return;
    }

    setFeedbackSubmitting(true);
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          token: orderConfirmation.trackingToken,
          rating: feedbackRating,
          comment: feedbackComment.trim(),
        }),
      });
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!response.ok || !isRecord(payload) || payload.saved !== true) {
        throw new Error(
          isRecord(payload) && typeof payload.error === "string"
            ? payload.error
            : "Could not save your feedback. Please try again.",
        );
      }
      setFeedbackMessage("Thank you. Your feedback has been saved.");
    } catch (cause) {
      setFeedbackError(
        cause instanceof Error
          ? cause.message
          : "Could not save your feedback. Please try again.",
      );
    } finally {
      setFeedbackSubmitting(false);
    }
  }

  return (
    <main
      className={`vr-menu-page${page === "menu" ? " vr-menu-home" : ""}${page === "menu" && cartItemCount > 0 ? " has-cart-bar" : ""}`}
      data-customer-theme="dark"
    >
      <div className="vr-menu-shell">
        <header className="vr-menu-header">
          <Link aria-label="Virtual Rudra menu home" className="vr-menu-brand" href={tableHref("/menu")}>
            <Image
              alt=""
              className="vr-menu-brand-mark"
              height={403}
              src="/brand/virtual-rudra-logo.png?v=2"
              unoptimized
              width={587}
            />
            <span>
              <strong>Virtual Rudra</strong>
              <small>RESTAURANT &amp; KITCHEN</small>
            </span>
          </Link>
          <nav aria-label="Order pages" className="vr-menu-order-nav">
            <Link aria-current={page === "menu" ? "page" : undefined} href={tableHref("/menu")}>Menu</Link>
            <Link aria-current={page === "cart" ? "page" : undefined} href={tableHref("/cart")}>
              Cart{cartItemCount > 0 ? ` (${cartItemCount})` : ""}
            </Link>
            <Link
              aria-current={page === "checkout" || page === "thank-you" ? "page" : undefined}
              href={tableHref("/checkout")}
            >
              Checkout
            </Link>
          </nav>
          {page === "menu" && (
            <label className="vr-menu-header-search-field">
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <circle cx="10.8" cy="10.8" r="6.8" />
                <path d="m16 16 4.2 4.2" />
              </svg>
              <input
                aria-label="Search menu"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search dishes or categories..."
                type="search"
                value={search}
              />
            </label>
          )}
          <Link
            aria-label={`View cart${cartItemCount > 0 ? `, ${cartItemCount} items` : ""}`}
            className="vr-menu-header-cart"
            href={tableHref("/cart")}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M3 4h2l2.2 11.2a2 2 0 0 0 2 1.6h8.5a2 2 0 0 0 2-1.6L21 8H6" />
              <circle cx="10" cy="21" r="1" />
              <circle cx="18" cy="21" r="1" />
            </svg>
            {cartItemCount > 0 && <span>{cartItemCount}</span>}
          </Link>
          <CustomerThemeToggle />
          {page === "menu" && (
            <button
              aria-label="Search dishes"
              className="vr-menu-header-search"
              onClick={focusMenuSearch}
              title="Search dishes"
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <circle cx="10.8" cy="10.8" r="6.8" />
                <path d="m16 16 4.2 4.2" />
              </svg>
            </button>
          )}
          <span className="vr-menu-header-note">
            <i aria-hidden="true" />
            Freshly made, always
          </span>
        </header>

        {page !== "menu" && (tableId !== null && tableNumber && !tableNumberMismatch ? (
          <div className="vr-menu-table-notice">
            <span>ORDERING AT</span>
            <strong>Table {tableNumber}</strong>
          </div>
        ) : tableId !== null && data ? (
          <div className="vr-menu-table-notice is-invalid" role="status">
            <strong>Table not recognized</strong>
            <span>Please ask a team member for assistance.</span>
          </div>
        ) : null)}

        {page === "menu" && <section aria-labelledby="menu-title" className="vr-menu-intro">
          <h1 className="sr-only" id="menu-title">Explore the Virtual Rudra menu</h1>
          <div
            aria-label="Featured dishes"
            aria-live="off"
            aria-roledescription="carousel"
            className="vr-menu-hero"
            onPointerDown={(event) => {
              heroPointerStart.current = event.clientX;
            }}
            onPointerUp={(event) => {
              const start = heroPointerStart.current;
              heroPointerStart.current = null;
              if (start === null || Math.abs(event.clientX - start) < 44) return;
              showHeroSlide(event.clientX < start ? 1 : -1);
            }}
            onPointerCancel={() => {
              heroPointerStart.current = null;
            }}
            role="region"
          >
            <Image
              alt=""
              className="vr-menu-hero-image"
              fill
              key={activeHeroSlide.id}
              onError={(event) => {
                if (!event.currentTarget.src.endsWith("/brand/virtual-rudra-awadhi-hero.jpg")) {
                  event.currentTarget.src = "/brand/virtual-rudra-awadhi-hero.jpg";
                }
              }}
              priority
              sizes="(max-width: 600px) 100vw, 1200px"
              src={activeHeroSlide.imageUrl}
              unoptimized
            />
            <div className="vr-menu-hero-copy" key={`${activeHeroSlide.id}-copy`}>
              <p>{activeHeroSlide.kicker}</p>
              <h2>
                {heroTitleLead && <>{heroTitleLead} </>}
                <span>{heroTitleAccent}</span>
              </h2>
              <span className="vr-menu-hero-description">
                {activeHeroSlide.description}
              </span>
              <a href="#menu-results">Order Now <span aria-hidden="true">→</span></a>
            </div>
            {heroSlides.length > 1 && (
              <div aria-label="Featured dish slides" className="vr-menu-hero-controls" role="group">
                <button
                  aria-label="Previous featured dish"
                  className="vr-menu-hero-arrow is-previous"
                  onClick={() => showHeroSlide(-1)}
                  type="button"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <path d="m15 18-6-6 6-6" />
                  </svg>
                </button>
                <div className="vr-menu-hero-dots">
                  {heroSlides.map((slide, index) => (
                    <button
                      aria-label={`Show ${slide.title}`}
                      aria-pressed={activeHeroSlideIndex === index}
                      className={activeHeroSlideIndex === index ? "is-active" : ""}
                      key={slide.id}
                      onClick={() => setHeroSlideIndex(index)}
                      type="button"
                    />
                  ))}
                </div>
                <button
                  aria-label="Next featured dish"
                  className="vr-menu-hero-arrow is-next"
                  onClick={() => showHeroSlide(1)}
                  type="button"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </button>
              </div>
            )}
          </div>
          <div className={`vr-menu-search${filterOpen ? " is-filter-open" : ""}`}>
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <circle cx="10.8" cy="10.8" r="6.8" />
              <path d="m16 16 4.2 4.2" />
            </svg>
            <input
              aria-label="Search menu"
              id="menu-search"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search for dishes or categories..."
              ref={searchInputRef}
              type="search"
              value={search}
            />
            <button
              aria-label={`Filter menu items: ${menuFilter === "all" ? "all dishes" : menuFilter === "vegetarian" ? "vegetarian" : "chef's choice"}`}
              aria-pressed={menuFilter !== "all"}
              aria-expanded={filterOpen}
              aria-controls={filterOpen ? "menu-filter-options" : undefined}
              className={`vr-menu-search-filter${menuFilter !== "all" ? " is-active" : ""}`}
              onClick={() => setFilterOpen((open) => !open)}
              title={`Filter: ${menuFilter === "all" ? "all dishes" : menuFilter === "vegetarian" ? "pure vegetarian" : "chef's choice"}`}
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M4 7h9m4 0h3M4 17h3m4 0h9" />
                <circle cx="15" cy="7" r="2" />
                <circle cx="9" cy="17" r="2" />
              </svg>
            </button>
            {filterOpen && (
              <div
                aria-label="Filter menu items"
                className="vr-menu-search-filter-menu"
                id="menu-filter-options"
                role="group"
              >
                {([
                  ["all", "All dishes"],
                  ["vegetarian", "Pure vegetarian"],
                  ["special", "Chef's choice"],
                ] as const).map(([filter, label]) => (
                  <button
                    aria-pressed={menuFilter === filter}
                    className={menuFilter === filter ? "is-selected" : undefined}
                    key={filter}
                    onClick={() => {
                      setMenuFilter(filter);
                      setFilterOpen(false);
                    }}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {search && (
              <button
                aria-label="Clear search"
                className="vr-menu-clear-search"
                onClick={() => setSearch("")}
                type="button"
              >
                Clear
              </button>
            )}
          </div>
        </section>}

        {page === "menu" && data && (
          <section aria-labelledby="menu-categories-title" className="vr-menu-category-discovery">
            <div className="vr-menu-category-discovery-heading">
              <h2 id="menu-categories-title">EPICUREAN CATEGORIES</h2>
              <a href="#menu-results">Explore <span aria-hidden="true">→</span></a>
            </div>
            <nav aria-label="Menu categories" className="vr-menu-category-rail">
              {categories
                .filter((category) => (itemCounts.get(category.id) ?? 0) > 0)
                .map((category) => {
                  const categoryImage =
                    category.imageUrl.trim() ||
                    data.menuItems
                      .find((item) => item.categoryId === category.id)
                      ?.imageUrl.trim() ||
                    "/brand/virtual-rudra-awadhi-hero.jpg";
                  return (
                    <button
                      aria-pressed={selectedCategory === category.id}
                      className={selectedCategory === category.id ? "is-selected" : ""}
                      key={category.id}
                      onClick={() => {
                        setSelectedCategory((selected) =>
                          selected === category.id ? "all" : category.id,
                        );
                        document.getElementById("menu-results")?.scrollIntoView({
                          block: "start",
                        });
                      }}
                      type="button"
                    >
                      <span className="vr-menu-category-rail-image">
                        <Image
                          alt=""
                          fill
                          sizes="(max-width: 600px) 64px, 76px"
                          src={categoryImage}
                          onError={(event) => {
                            event.currentTarget.src =
                              "/brand/virtual-rudra-awadhi-hero.jpg";
                          }}
                          unoptimized
                        />
                      </span>
                      <span className="vr-menu-category-rail-name">{category.name}</span>
                    </button>
                  );
                })}
            </nav>
          </section>
        )}
        {page === "menu" && (tableId !== null && tableNumber && !tableNumberMismatch ? (
          <div className="vr-menu-table-notice">
            <span>ORDERING AT</span>
            <strong>Table {tableNumber}</strong>
          </div>
        ) : tableId !== null && data ? (
          <div className="vr-menu-table-notice is-invalid" role="status">
            <strong>Table not recognized</strong>
            <span>Please ask a team member for assistance.</span>
          </div>
        ) : null)}

        {(page === "cart" || page === "checkout") && !data && (
          <section aria-live="polite" className="vr-menu-cart">
            <div className="vr-menu-cart-empty">
              <p role={loadError ? "alert" : "status"}>
                {loadError || "Loading your order…"}
              </p>
              {loadError && (
                <button
                  className="vr-menu-place-order"
                  onClick={() => {
                    setLoadError("");
                    setMenuRetryCount((count) => count + 1);
                  }}
                  type="button"
                >
                  Try again
                </button>
              )}
            </div>
          </section>
        )}

        {page === "cart" && data && (
          <section aria-labelledby="cart-title" className="vr-menu-cart">
            <div className="vr-menu-cart-heading">
              <div>
                <p className="vr-menu-category-kicker">READY WHEN YOU ARE</p>
                <h2 id="cart-title">Your cart</h2>
              </div>
              <span>
                {cartItemCount} {cartItemCount === 1 ? "item" : "items"}
              </span>
            </div>
            {cartItems.length === 0 ? (
              <div className="vr-menu-cart-empty">
                <p>Your cart is empty. Add a dish to get started.</p>
                <Link href={tableHref("/menu")}>Continue Shopping</Link>
              </div>
            ) : (
              <div className="vr-menu-cart-layout">
                <ul className="vr-menu-cart-items">
                  {cartItems.map(({ item, quantity, isUnavailable }) => {
                    const line = cart.find((entry) => entry.itemId === item.id);
                    return (
                    <li className="vr-menu-cart-item" key={item.id}>
                      <div className="vr-menu-cart-thumbnail">
                        {item.imageUrl ? (
                          <Image
                            alt={item.name}
                            fill
                            sizes="(max-width: 700px) 76px, 88px"
                            src={item.imageUrl}
                            onError={(event) => {
                              event.currentTarget.src =
                                "/brand/virtual-rudra-awadhi-hero.jpg";
                            }}
                            unoptimized
                          />
                        ) : (
                          <span aria-hidden="true">VR</span>
                        )}
                      </div>
                      <div className="vr-menu-cart-item-details">
                        <strong>{item.name}</strong>
                        <span>
                          {isUnavailable
                            ? "No longer available · Remove this item to continue"
                            : `${formatINR.format(item.priceINR)} each`}
                        </span>
                        {line && (
                          <>
                            <small>Spice: {line.spiceLevel}</small>
                            {line.specialInstructions && (
                              <small>Note: {line.specialInstructions}</small>
                            )}
                            <button
                              className="vr-menu-customize"
                              disabled={isSubmittingOrder || isUnavailable}
                              onClick={() => openDishCustomization(item)}
                              type="button"
                            >
                              Customize
                            </button>
                          </>
                        )}
                      </div>
                      <div className="vr-menu-cart-controls">
                        <button
                          aria-label={`Decrease ${item.name} quantity`}
                          disabled={isSubmittingOrder}
                          onClick={() => changeCartQuantity(item.id, -1)}
                          type="button"
                        >
                          −
                        </button>
                        <span aria-live="polite">{quantity}</span>
                        <button
                          aria-label={`Increase ${item.name} quantity`}
                          disabled={
                            !item.isAvailable ||
                            isSubmittingOrder ||
                            quantity >= MAX_ORDER_QUANTITY
                          }
                          onClick={() => changeCartQuantity(item.id, 1)}
                          type="button"
                        >
                          +
                        </button>
                        <button
                          aria-label={`Remove ${item.name} from cart`}
                          className="vr-menu-cart-remove"
                          disabled={isSubmittingOrder}
                          onClick={() => removeFromCart(item.id)}
                          type="button"
                        >
                          Remove
                        </button>
                      </div>
                      <strong className="vr-menu-cart-line-total">
                        {isUnavailable
                          ? "Unavailable"
                          : formatINR.format(item.priceINR * quantity)}
                      </strong>
                    </li>
                    );
                  })}
                </ul>
                {hasUnavailableItems && (
                  <p className="vr-menu-checkout-message" role="alert">
                    Remove unavailable items before continuing to checkout.
                  </p>
                )}
                <aside aria-label="Order summary" className="vr-menu-cart-summary">
                  <h3>Order Summary</h3>
                  <dl className="vr-menu-cart-totals">
                    <div>
                      <dt>Subtotal</dt>
                      <dd>{formatINR.format(subtotal)}</dd>
                    </div>
                    <div>
                      <dt>Total</dt>
                      <dd>{formatINR.format(subtotal)}</dd>
                    </div>
                  </dl>
                  <Link className="vr-menu-place-order" href={tableHref("/checkout")}>
                    Proceed to Checkout
                    <span aria-hidden="true">→</span>
                  </Link>
                  <Link className="vr-menu-cart-continue" href={tableHref("/menu")}>
                    ← Continue Shopping
                  </Link>
                </aside>
              </div>
            )}
            {cartStorageError && <p className="vr-menu-checkout-message" role="alert">{cartStorageError}</p>}
          </section>
        )}

        {page === "thank-you" && !confirmationReady ? (
          <p className="vr-menu-message" role="status">Loading your confirmation…</p>
        ) : page === "thank-you" && confirmationReady && orderConfirmation ? (
          <section
            aria-labelledby="order-confirmation-title"
            className="vr-menu-confirmation vr-order-confirmation"
            role="status"
          >
            <header className="vr-order-confirmation-hero">
              <span aria-hidden="true" className="vr-menu-confirmation-icon">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="m6 12.5 4 4 8-9" />
                </svg>
              </span>
              <p className="vr-menu-category-kicker">ORDER CONFIRMED</p>
              <h2 id="order-confirmation-title">Thank You for Your Order!</h2>
              <p className="vr-menu-confirmation-message">
                Your order has been received and confirmed.
              </p>
              {orderConfirmation.customerDetailsSaveNotice && (
                <p className="vr-menu-checkout-message" role="alert">
                  {orderConfirmation.customerDetailsSaveNotice}
                </p>
              )}
            </header>
            <dl className="vr-menu-confirmation-details">
              <div>
                <dt>Order ID</dt>
                <dd>{orderConfirmation.id}</dd>
              </div>
              <div>
                <dt>Total amount</dt>
                <dd>{formatINR.format(orderConfirmation.total)}</dd>
              </div>
              <div>
                <dt>Table</dt>
                <dd>Table {orderConfirmation.tableNumber}</dd>
              </div>
              {orderConfirmation.couponCode && (
                <div>
                  <dt>Coupon</dt>
                  <dd>
                    {orderConfirmation.couponCode}
                    {orderConfirmation.discountAmount
                      ? ` · ${formatINR.format(orderConfirmation.discountAmount)} off`
                      : ""}
                  </dd>
                </div>
              )}
            </dl>
            <section aria-label="Order summary" className="vr-order-summary">
              <div className="vr-order-summary-heading">
                <h3>Order Summary</h3>
                <span>
                  {confirmedItemCount} {confirmedItemCount === 1 ? "item" : "items"}
                </span>
              </div>
              <ul>
                {orderConfirmation.items.map((item) => (
                  <li key={item.itemId}>
                    <span className="vr-order-summary-item">
                      <span className="vr-order-summary-item-heading">
                        <strong>{item.name}</strong>
                        <small>{item.quantity}×</small>
                      </span>
                      <span className="vr-order-summary-item-details">
                        <small>Spice: {item.spiceLevel ?? "Mild"}</small>
                        {item.specialInstructions && (
                          <small>Note: {item.specialInstructions}</small>
                        )}
                      </span>
                    </span>
                    <strong>{formatINR.format(item.unitPrice * item.quantity)}</strong>
                  </li>
                ))}
              </ul>
              {(orderConfirmation.subtotal !== undefined ||
                orderConfirmation.taxAmount !== undefined) && (
                <dl className="vr-order-summary-totals">
                  {orderConfirmation.subtotal !== undefined && (
                    <div>
                      <dt>Subtotal</dt>
                      <dd>{formatINR.format(orderConfirmation.subtotal)}</dd>
                    </div>
                  )}
                  {orderConfirmation.couponCode &&
                    (orderConfirmation.discountAmount ?? 0) > 0 && (
                      <div>
                        <dt>Coupon ({orderConfirmation.couponCode})</dt>
                        <dd>
                          -{formatINR.format(orderConfirmation.discountAmount ?? 0)}
                        </dd>
                      </div>
                    )}
                  {orderConfirmation.taxAmount !== undefined && (
                    <div>
                      <dt>
                        {orderConfirmation.taxRatePercent === undefined
                          ? "GST / Tax"
                          : `GST (${orderConfirmation.taxRatePercent}%)`}
                      </dt>
                      <dd>{formatINR.format(orderConfirmation.taxAmount)}</dd>
                    </div>
                  )}
                </dl>
              )}
              <div className="vr-order-summary-total">
                <span>Grand Total</span>
                <strong>{formatINR.format(orderConfirmation.total)}</strong>
              </div>
            </section>
            <div className="vr-order-confirmation-actions">
              <Link
                className="vr-order-confirmation-action vr-order-confirmation-track"
                href={`/track/${orderConfirmation.trackingToken}`}
                prefetch={false}
              >
                Track Order <span aria-hidden="true">→</span>
              </Link>
              <Link
                className="vr-order-confirmation-action"
                href={`/invoice/${orderConfirmation.trackingToken}?download=1`}
                prefetch={false}
              >
                Download Invoice
              </Link>
            </div>
            <Link className="vr-order-confirmation-menu" href={tableHref("/menu")}>
              Back to Menu
            </Link>
            <form
              aria-labelledby="feedback-title"
              className="vr-order-feedback"
              onSubmit={handleFeedbackSubmit}
            >
              <h3 id="feedback-title">Share Your Experience</h3>
              <p>How was your visit to Virtual Rudra?</p>
              <fieldset>
                <legend>Rate your experience</legend>
                <div className="vr-order-feedback-stars" role="group" aria-label="Rate your experience">
                  {[1, 2, 3, 4, 5].map((rating) => (
                    <button
                      aria-label={`${rating} ${rating === 1 ? "star" : "stars"}`}
                      aria-pressed={feedbackRating === rating}
                      className={feedbackRating >= rating ? "is-selected" : undefined}
                      disabled={feedbackSubmitting || Boolean(feedbackMessage)}
                      key={rating}
                      onClick={() => setFeedbackRating(rating)}
                      type="button"
                    >
                      ★
                    </button>
                  ))}
                </div>
              </fieldset>
              <p aria-live="polite" className="vr-order-feedback-rating">
                {feedbackRating
                  ? `${feedbackRating} of 5 stars selected`
                  : "Select a star rating"}
              </p>
              <label htmlFor="customer-feedback-comment">
                Comment <span>(optional)</span>
              </label>
              <textarea
                disabled={feedbackSubmitting || Boolean(feedbackMessage)}
                id="customer-feedback-comment"
                maxLength={1000}
                onChange={(event) => setFeedbackComment(event.target.value)}
                placeholder="Tell us about your visit"
                value={feedbackComment}
              />
              {feedbackError && <p className="vr-order-feedback-error" role="alert">{feedbackError}</p>}
              {feedbackMessage && <p className="vr-order-feedback-success" role="status">{feedbackMessage}</p>}
              <button
                className="vr-order-feedback-submit"
                disabled={feedbackSubmitting || Boolean(feedbackMessage)}
                type="submit"
              >
                {feedbackSubmitting ? "Saving feedback…" : "Submit Feedback"}
              </button>
            </form>
          </section>
        ) : page === "thank-you" && confirmationReady ? (
          <section aria-labelledby="order-confirmation-title" className="vr-menu-confirmation">
            <p className="vr-menu-category-kicker">ORDER CONFIRMATION</p>
            <h2 id="order-confirmation-title">No order confirmation found</h2>
            <p className="vr-menu-confirmation-message">
              {confirmationError || "Place an order to see its confirmation here."}
            </p>
            <Link className="vr-menu-place-order" href={tableHref("/menu")}>
              Back to Menu
            </Link>
          </section>
        ) : page === "checkout" &&
          data &&
          !orderConfirmation &&
          cartItems.length === 0 ? (
          <section
            aria-labelledby="checkout-title"
            className="vr-menu-cart vr-menu-checkout-empty"
          >
            <div>
              <p className="vr-menu-category-kicker">ALMOST THERE</p>
              <h2 id="checkout-title">Your cart is empty</h2>
            </div>
            <p className="vr-menu-confirmation-message">
              Add a dish from the menu before checking out.
            </p>
            {cartStorageError && (
              <p className="vr-menu-checkout-message" role="alert">
                {cartStorageError}
              </p>
            )}
            <Link className="vr-menu-place-order" href={tableHref("/menu")}>
              Browse the menu <span aria-hidden="true">→</span>
            </Link>
          </section>
        ) : page === "checkout" && data && (
          <form
            aria-describedby="checkout-intro"
            aria-labelledby="checkout-title"
            className="vr-menu-checkout"
            onSubmit={handleCheckout}
          >
            <div className="vr-menu-cart-heading">
              <div>
                <p className="vr-menu-category-kicker">ALMOST THERE</p>
                <h2 id="checkout-title">Checkout</h2>
                <p className="vr-menu-checkout-intro" id="checkout-intro">
                  Add your details, then review your dishes before placing the order.
                </p>
              </div>
              <Link href={tableHref("/cart")}>← Back to cart</Link>
            </div>
            <div className="vr-menu-checkout-fields">
              <p className="vr-menu-checkout-step">01 <span>YOUR DETAILS</span></p>
              <p className="vr-menu-confirmation-message">
                Details are saved in this browser after a successful checkout and can be edited here.
              </p>
              <label>
                Customer name
                <input
                  autoComplete="name"
                  name="customerName"
                  onChange={(event) => {
                    setCustomerName(event.target.value);
                    setCheckoutMessage("");
                  }}
                  disabled={isSubmittingOrder || orderConfirmation !== null}
                  required
                  value={customerName}
                />
              </label>
              <label>
                Phone number
                <input
                  autoComplete="tel"
                  inputMode="tel"
                  name="customerPhone"
                  onChange={(event) => {
                    setCustomerPhone(event.target.value);
                    setCheckoutMessage("");
                  }}
                  disabled={isSubmittingOrder || orderConfirmation !== null}
                  required
                  type="tel"
                  value={customerPhone}
                />
              </label>
              {customerDetailsNotice && (
                <p className="vr-menu-checkout-message" role="alert">
                  {customerDetailsNotice}
                </p>
              )}
              <label>
                Table number
                <input
                  inputMode="numeric"
                  name="tableNumber"
                  onChange={(event) => {
                    setCheckoutTableNumber(event.target.value);
                    setCheckoutMessage("");
                  }}
                  disabled={isSubmittingOrder || orderConfirmation !== null}
                  readOnly={tableNumber !== null && tableNumber !== undefined}
                  required
                  type="number"
                  min="1"
                  value={
                    tableNumber !== null && tableNumber !== undefined
                      ? String(tableNumber)
                      : checkoutTableNumber
                  }
                />
                {tableNumber !== null && tableNumber !== undefined && (
                  <small>Assigned from your table QR code</small>
                )}
              </label>
            </div>
            {cartItems.length > 0 && (
              <div className="vr-menu-coupon">
                <label htmlFor="coupon-code">Coupon / Offer code</label>
                <div className="vr-menu-coupon-row">
                  <input
                    id="coupon-code"
                    disabled={isApplyingCoupon || orderConfirmation !== null}
                    maxLength={32}
                    onChange={(event) => {
                      setCouponCode(event.target.value.toUpperCase());
                      setCouponMessage("");
                    }}
                    placeholder="Enter code"
                    value={couponCode}
                  />
                  <button
                    disabled={
                      isApplyingCoupon ||
                      !couponCode.trim() ||
                      orderConfirmation !== null
                    }
                    onClick={applyCoupon}
                    type="button"
                  >
                    {isApplyingCoupon ? "Applying…" : appliedCouponCode ? "Reapply" : "Apply"}
                  </button>
                </div>
                {couponMessage && (
                  <p aria-live="polite" role="status">
                    {couponMessage}
                  </p>
                )}
              </div>
            )}
            <div aria-label="Order summary" className="vr-menu-checkout-summary">
              <div className="vr-menu-checkout-summary-heading">
                <div>
                  <p className="vr-menu-checkout-step">02 <span>ORDER REVIEW</span></p>
                </div>
                <span>{cartItemCount} {cartItemCount === 1 ? "item" : "items"}</span>
              </div>
              {cartItems.length === 0 ? (
                <p>
                  {orderConfirmation
                    ? `Order ${orderConfirmation.id} placed · ${formatINR.format(orderConfirmation.total)}`
                    : "Your cart is empty."}
                </p>
              ) : (
                <ul>
                  {cartItems.map(({ item, quantity }) => {
                    const line = cart.find((entry) => entry.itemId === item.id);
                    return (
                    <li key={item.id}>
                      <span>
                        <strong>{item.name}</strong>
                        <small>
                          {hasUnavailableItems && !item.isAvailable
                            ? "Unavailable · remove from cart"
                            : `Qty ${quantity} × ${formatINR.format(item.priceINR)}`}
                        </small>
                        {!hasUnavailableItems || item.isAvailable ? (
                          <>
                            <small>Spice: {line?.spiceLevel ?? "Mild"}</small>
                            {line?.specialInstructions && (
                              <small>Note: {line.specialInstructions}</small>
                            )}
                          </>
                        ) : null}
                      </span>
                      <strong>
                        {!item.isAvailable
                          ? "Unavailable"
                          : formatINR.format(item.priceINR * quantity)}
                      </strong>
                    </li>
                    );
                  })}
                </ul>
              )}
              <dl className="vr-menu-cart-totals">
                <div>
                  <dt>Subtotal</dt>
                  <dd>{formatINR.format(checkoutSubtotal)}</dd>
                </div>
                {checkoutCouponCode && checkoutDiscountAmount > 0 && (
                  <div>
                    <dt>Coupon {checkoutCouponCode}</dt>
                    <dd>-{formatINR.format(checkoutDiscountAmount)}</dd>
                  </div>
                )}
                <div>
                  <dt>GST ({checkoutTaxRatePercent}%)</dt>
                  <dd>{formatINR.format(checkoutTaxAmount)}</dd>
                </div>
              </dl>
              <div className="vr-menu-checkout-total">
                <span>Grand Total</span>
                <strong>{formatINR.format(checkoutTotal)}</strong>
              </div>
            </div>
            {checkoutMessage && (
              <p aria-live="polite" className="vr-menu-checkout-message" role="status">
                {checkoutMessage}
              </p>
            )}
            {hasUnavailableItems && (
              <p className="vr-menu-checkout-message" role="alert">
                Remove unavailable items from your cart before placing this order.
              </p>
            )}
            {cartStorageError && <p className="vr-menu-checkout-message" role="alert">{cartStorageError}</p>}
            <button
              className="vr-menu-place-order"
              disabled={
                isSubmittingOrder ||
                orderConfirmation !== null ||
                cartItems.length === 0 ||
                hasUnavailableItems
              }
              type="submit"
            >
              <span className="vr-menu-place-order-amount">
                <small>TOTAL PAYABLE</small>
                <strong>
                  {formatINR.format(checkoutTotal)}
                </strong>
              </span>
              <span className="vr-menu-place-order-action">
                {isSubmittingOrder ? "Submitting Order…" : "Place Order"}
                {!isSubmittingOrder && <span aria-hidden="true">→</span>}
              </span>
            </button>
          </form>
        )}

        {page === "menu" && <div className="vr-menu-results" id="menu-results">
          {loadError ? (
            <>
              <p className="vr-menu-message" role="alert">{loadError}</p>
              <button
                className="vr-menu-place-order"
                onClick={() => {
                  setLoadError("");
                  setMenuRetryCount((count) => count + 1);
                }}
                type="button"
              >
                Try again
              </button>
            </>
          ) : !data ? (
            <p className="vr-menu-message" role="status">Loading the menu…</p>
          ) : resultCount === 0 ? (
            <div className="vr-menu-empty">
              <span aria-hidden="true">✦</span>
              <h2>No dishes found</h2>
              <p>Try another search or choose a different category.</p>
            </div>
          ) : (
            <>
              <div className="vr-menu-results-heading">
                <div>
                  <p>{selectedCategory === "all" ? "MADE FRESH, SERVED WITH LOVE" : "YOUR SELECTION"}</p>
                  <h2 id="menu-grid-title">
                    {selectedCategory === "all"
                      ? "Our Menu"
                      : categories.find((category) => category.id === selectedCategory)?.name}
                  </h2>
                </div>
                <span>{resultCount} {resultCount === 1 ? "dish" : "dishes"}</span>
              </div>
              <section aria-labelledby="menu-grid-title" className="vr-menu-category">
                <div className="vr-menu-grid">
                  {groups.flatMap(({ items }) =>
                    items.map((item) => {
                      const quantity =
                        cart.find((line) => line.itemId === item.id)?.quantity ?? 0;
                      return (
                        <article
                          className={`vr-menu-card vr-menu-item-card${item.isAvailable ? "" : " is-unavailable"}`}
                          key={item.id}
                        >
                          <div className="vr-menu-photo">
                            <Image
                              alt=""
                              fill
                              loading={item.id === groups[0]?.items[0]?.id ? "eager" : "lazy"}
                              sizes="(max-width: 600px) 48vw, (max-width: 1180px) 48vw, 25vw"
                              src={item.imageUrl.trim() || "/brand/virtual-rudra-awadhi-hero.jpg"}
                              onError={(event) => {
                                event.currentTarget.src =
                                  "/brand/virtual-rudra-awadhi-hero.jpg";
                              }}
                              unoptimized
                            />
                            <div className="vr-menu-item-badges">
                              {VEGETARIAN_ITEM_IDS.has(item.id) && (
                                <span className="is-veg"><i aria-hidden="true" />Veg</span>
                              )}
                              {SPECIAL_ITEM_IDS.has(item.id) && (
                                <span className="is-special">Chef Special</span>
                              )}
                            </div>
                          </div>
                          <div className="vr-menu-card-content">
                            <div className="vr-menu-card-title">
                              <button
                                aria-label={`View details for ${item.name}`}
                                className="vr-menu-details-button"
                                onClick={() => openDishCustomization(item)}
                                type="button"
                              >
                                {item.name}
                              </button>
                              {!item.isAvailable && <span>Unavailable</span>}
                            </div>
                            {item.description && <p>{item.description}</p>}
                            <div className="vr-menu-card-actions">
                              <strong className="vr-menu-price">
                                {formatINR.format(item.priceINR)}
                              </strong>
                              {quantity > 0 ? (
                                <div aria-label={`${item.name} quantity`} className="vr-menu-item-quantity">
                                  <button
                                    aria-label={`Decrease ${item.name} quantity`}
                                    disabled={isSubmittingOrder}
                                    onClick={() => changeCartQuantity(item.id, -1)}
                                    type="button"
                                  >
                                    −
                                  </button>
                                  <span aria-live="polite">{quantity}</span>
                                  <button
                                    aria-label={`Increase ${item.name} quantity`}
                                    disabled={
                                      isSubmittingOrder ||
                                      quantity >= MAX_ORDER_QUANTITY
                                    }
                                    onClick={() => changeCartQuantity(item.id, 1)}
                                    type="button"
                                  >
                                    +
                                  </button>
                                </div>
                              ) : (
                                <button
                                  className="vr-menu-add-button"
                                  disabled={
                                    !item.isAvailable ||
                                    isSubmittingOrder ||
                                    cart.length >= MAX_ORDER_LINES
                                  }
                                  onClick={() => openDishCustomization(item)}
                                  type="button"
                                >
                                  {item.isAvailable && (
                                    <svg aria-hidden="true" viewBox="0 0 24 24">
                                      <path d="M12 5v14M5 12h14" />
                                    </svg>
                                  )}
                                  {item.isAvailable ? "Add" : "Unavailable"}
                                </button>
                              )}
                            </div>
                          </div>
                        </article>
                      );
                    }),
                  )}
                </div>
              </section>
            </>
          )}
        </div>}
        <dialog
          aria-labelledby="dish-details-title"
          className="vr-menu-dish-dialog"
          onClose={() => setSelectedDish(null)}
          ref={dishDetailsRef}
        >
          {selectedDish && (
            <div className="vr-menu-dish-dialog-content">
              <button
                aria-label="Close dish details"
                className="vr-menu-dish-dialog-close"
                onClick={() => setSelectedDish(null)}
                type="button"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
              <div className="vr-menu-dish-dialog-photo">
                {selectedDish.imageUrl.trim() ? (
                  <Image
                    alt={selectedDish.name}
                    fill
                    sizes="(max-width: 700px) 100vw, 42vw"
                    src={selectedDish.imageUrl.trim()}
                    onError={(event) => {
                      event.currentTarget.src =
                        "/brand/virtual-rudra-awadhi-hero.jpg";
                    }}
                    unoptimized
                  />
                ) : (
                  <span aria-hidden="true" className="vr-menu-photo-mark">VR</span>
                )}
              </div>
              <div className="vr-menu-dish-dialog-copy">
                <p className="vr-menu-category-kicker">FROM OUR KITCHEN</p>
                <h2 id="dish-details-title">{selectedDish.name}</h2>
                {selectedDish.description && <p>{selectedDish.description}</p>}
                <div className="vr-menu-dish-dialog-meta">
                  {VEGETARIAN_ITEM_IDS.has(selectedDish.id) && (
                    <span className="is-veg"><i aria-hidden="true" />Vegetarian</span>
                  )}
                  {SPECIAL_ITEM_IDS.has(selectedDish.id) && (
                    <span className="is-special">Chef Special</span>
                  )}
                  {!selectedDish.isAvailable && <span>Currently unavailable</span>}
                </div>
                <div className="vr-menu-customization">
                  <fieldset>
                    <legend>Spice level</legend>
                    <div className="vr-menu-spice-options">
                      {(["Mild", "Medium", "Spicy"] as const).map((level) => (
                        <button
                          aria-pressed={customizationSpiceLevel === level}
                          className={customizationSpiceLevel === level ? "is-selected" : ""}
                          key={level}
                          onClick={() => setCustomizationSpiceLevel(level)}
                          type="button"
                        >
                          {level}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <div className="vr-menu-customization-row">
                    <span>Quantity</span>
                    <div className="vr-menu-item-quantity">
                      <button
                        aria-label="Decrease quantity"
                        disabled={customizationQuantity <= 1}
                        onClick={() => setCustomizationQuantity((quantity) => Math.max(1, quantity - 1))}
                        type="button"
                      >
                        −
                      </button>
                      <span aria-live="polite">{customizationQuantity}</span>
                      <button
                        aria-label="Increase quantity"
                        disabled={customizationQuantity >= MAX_ORDER_QUANTITY}
                        onClick={() => setCustomizationQuantity((quantity) => Math.min(MAX_ORDER_QUANTITY, quantity + 1))}
                        type="button"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <label>
                    Special instructions <span>(optional)</span>
                    <textarea
                      maxLength={MAX_SPECIAL_INSTRUCTIONS}
                      onChange={(event) => setCustomizationInstructions(event.target.value)}
                      placeholder="Any requests for the kitchen?"
                      value={customizationInstructions}
                    />
                  </label>
                </div>
                <div className="vr-menu-dish-dialog-action">
                  <strong>{formatINR.format(selectedDish.priceINR * customizationQuantity)}</strong>
                  <button
                    className="vr-menu-place-order"
                    disabled={
                      !selectedDish.isAvailable ||
                      isSubmittingOrder ||
                      (!cart.some((line) => line.itemId === selectedDish.id) &&
                        cart.length >= MAX_ORDER_LINES)
                    }
                    onClick={saveDishCustomization}
                    type="button"
                  >
                    {selectedDish.isAvailable
                      ? cart.some((line) => line.itemId === selectedDish.id)
                        ? "Save changes"
                        : "Add to order"
                      : "Unavailable"}
                    <span aria-hidden="true">→</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </dialog>
        <footer className="vr-menu-footer">
          <Image
            alt=""
            className="vr-menu-brand-mark"
            height={403}
            src="/brand/virtual-rudra-logo.png?v=2"
            unoptimized
            width={587}
          />
          <div className="vr-menu-footer-brand">
            <strong>Virtual Rudra</strong>
            <p>Good food. Great moments.</p>
          </div>
          {page === "menu" && (
            <nav aria-label="Quick links" className="vr-menu-footer-links">
              <Link href={tableHref("/menu")}>Menu</Link>
              <Link href={tableHref("/cart")}>Cart</Link>
              <Link href={tableHref("/checkout")}>Checkout</Link>
            </nav>
          )}
        </footer>
        <nav aria-label="Mobile order navigation" className="vr-menu-mobile-nav">
          {page === "menu" ? (
            <>
              <Link aria-current="page" href={tableHref("/menu")}>
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="m3 11 9-8 9 8v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
                </svg>
                <span>Home</span>
              </Link>
              <button onClick={focusMenuSearch} type="button">
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <circle cx="10.8" cy="10.8" r="6.8" />
                  <path d="m16 16 4.2 4.2" />
                </svg>
                <span>Search</span>
              </button>
              <Link href={tableHref("/cart")}>
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M3 4h2l2.2 11.2a2 2 0 0 0 2 1.6h8.5a2 2 0 0 0 2-1.6L21 8H6" />
                  <circle cx="10" cy="21" r="1" />
                  <circle cx="18" cy="21" r="1" />
                </svg>
                <span>Cart{cartItemCount > 0 ? ` (${cartItemCount})` : ""}</span>
              </Link>
              <Link href={tableHref("/checkout")}>
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6" />
                </svg>
                <span>Checkout</span>
              </Link>
            </>
          ) : (
            <>
              <Link href={tableHref("/menu")}>
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M4 3v7m4-7v7M6 3v18M17 3v18m0-18c-2 2-3 5-3 8h6c0-3-1-6-3-8Z" />
                </svg>
                <span>Menu</span>
              </Link>
              <Link aria-current={page === "cart" ? "page" : undefined} href={tableHref("/cart")}>
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M3 4h2l2.2 11.2a2 2 0 0 0 2 1.6h8.5a2 2 0 0 0 2-1.6L21 8H6" />
                  <circle cx="10" cy="21" r="1" />
                  <circle cx="18" cy="21" r="1" />
                </svg>
                <span>Cart{cartItemCount > 0 ? ` (${cartItemCount})` : ""}</span>
              </Link>
              <Link aria-current={page === "checkout" || page === "thank-you" ? "page" : undefined} href={tableHref("/checkout")}>
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6" />
                </svg>
                <span>Order</span>
              </Link>
            </>
          )}
        </nav>
        {page === "menu" && cartItemCount > 0 && (
          <aside aria-label="Cart total" className="vr-menu-sticky-cart">
            <div className="vr-menu-sticky-cart-content">
              <span className="vr-menu-sticky-cart-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M3 4h2l2.2 11.2a2 2 0 0 0 2 1.6h8.5a2 2 0 0 0 2-1.6L21 8H6" />
                  <circle cx="10" cy="21" r="1" />
                  <circle cx="18" cy="21" r="1" />
                </svg>
              </span>
              <div className="vr-menu-sticky-cart-summary">
                <strong>{cartItemCount} {cartItemCount === 1 ? "item" : "items"} · {formatINR.format(subtotal)}</strong>
                <span>Your order</span>
              </div>
              <Link href={tableHref("/cart")}>
                View Cart
                <span aria-hidden="true">→</span>
              </Link>
            </div>
          </aside>
        )}
      </div>
    </main>
  );
}
