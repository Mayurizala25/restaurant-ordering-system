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

const CART_STORAGE_KEY = "virtual-rudra.order.cart";
const ORDER_CONFIRMATION_STORAGE_KEY = "virtual-rudra.order.confirmation";
const PENDING_ORDER_REQUEST_STORAGE_KEY = "virtual-rudra.order.pending-request";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ORDER_QUANTITY = 99;
const MAX_ORDER_LINES = 50;
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
};

type CartLine = { itemId: string; quantity: number };
type StorefrontPage = "menu" | "cart" | "checkout" | "thank-you";
type OrderConfirmation = {
  id: string;
  trackingToken: string;
  customerName: string;
  customerPhone: string;
  tableNumber: number;
  items: { itemId: string; name: string; quantity: number; unitPrice: number }[];
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
        item.unitPrice >= 0,
    ) &&
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCartLine(value: unknown): value is CartLine {
  return (
    isRecord(value) &&
    typeof value.itemId === "string" &&
    value.itemId.length > 0 &&
    value.itemId.length <= 128 &&
    typeof value.quantity === "number" &&
    Number.isSafeInteger(value.quantity) &&
    value.quantity >= 1 &&
    value.quantity <= MAX_ORDER_QUANTITY
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
  if (!parsed.every(isCartLine)) {
    throw new Error("Your saved cart is invalid. Add the items again to continue.");
  }
  if (new Set(parsed.map((line) => line.itemId)).size !== parsed.length) {
    throw new Error("Your saved cart contains duplicate items. Add them again to continue.");
  }

  return parsed;
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
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(serializedRequest),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
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
  const [tableId, setTableId] = useState<string | null>(null);
  const [qrTableNumber, setQrTableNumber] = useState<number | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartStorageError, setCartStorageError] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [checkoutTableNumber, setCheckoutTableNumber] = useState("");
  const [checkoutMessage, setCheckoutMessage] = useState("");
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const submissionLock = useRef(false);
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
    let active = true;
    let latestMenuRequest = 0;
    const refreshMenu = async () => {
      const requestId = ++latestMenuRequest;
      try {
        const response = await fetch("/api/menu", { cache: "no-store" });
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
          !payload.tables.every(isTable)
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
    window.addEventListener("popstate", handlePopState);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.clearTimeout(initializeTimer);
      active = false;
      window.removeEventListener("focus", handleFocus);
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
          if (!query) return true;
          return (
            item.name.toLocaleLowerCase().includes(query) ||
            item.description.toLocaleLowerCase().includes(query) ||
            category.name.toLocaleLowerCase().includes(query)
          );
        }),
      }))
      .filter((group) => group.items.length > 0);
  }, [categories, data, search, selectedCategory]);

  const resultCount = groups.reduce((count, group) => count + group.items.length, 0);
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
  const subtotal = cartItems.reduce(
    (total, line) =>
      total + (line.isUnavailable ? 0 : line.item.priceINR * line.quantity),
    0,
  );
  const selectedTable = data?.tables.find((table) => table.id === tableId);
  const tableNumber = qrTableNumber ?? selectedTable?.tableNumber;
  const tableQuery = new URLSearchParams();
  if (tableId) tableQuery.set("tableId", tableId);
  if (qrTableNumber !== null) tableQuery.set("tableNumber", String(qrTableNumber));
  const tableQueryString = tableQuery.toString();
  const tableQuerySuffix = tableQueryString ? `?${tableQueryString}` : "";
  const tableHref = (path: string) => `${path}${tableQuerySuffix}`;

  const addToCart = (item: DemoMenuItem) => {
    if (!item.isAvailable || isSubmittingOrder) return;
    submissionLock.current = false;
    setOrderConfirmation(null);
    const existingLine = cart.find((line) => line.itemId === item.id);
    if (
      (existingLine && existingLine.quantity >= MAX_ORDER_QUANTITY) ||
      (!existingLine && cart.length >= MAX_ORDER_LINES)
    ) {
      return;
    }
    updateCart(
      existingLine
        ? cart.map((line) =>
            line.itemId === item.id
              ? { ...line, quantity: line.quantity + 1 }
              : line,
          )
        : [...cart, { itemId: item.id, quantity: 1 }],
    );
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
      items: cart.map(({ itemId, quantity }) => ({ itemId, quantity })),
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
      result.total < 0
    ) {
      submissionLock.current = false;
      setIsSubmittingOrder(false);
      setCheckoutMessage(
        isRecord(result) && typeof result.error === "string"
          ? result.error
          : "The order could not be confirmed. Please retry.",
      );
      return;
    }

    const order: OrderConfirmation = {
      id: result.orderId,
      trackingToken: result.trackingToken,
      customerName: request.customerName,
      customerPhone: request.customerPhone,
      tableNumber: request.tableNumber,
      items: cartItems.map(({ item, quantity }) => ({
        itemId: item.id,
        name: item.name,
        quantity,
        unitPrice: item.priceINR,
      })),
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
    <main className={`vr-menu-page${page === "menu" && cartItemCount > 0 ? " has-cart-bar" : ""}`}>
      <div className="vr-menu-shell">
        <header className="vr-menu-header">
          <Link aria-label="Virtual Rudra menu home" className="vr-menu-brand" href={tableHref("/menu")}>
            <Image
              alt=""
              className="vr-menu-brand-mark"
              height={42}
              src="/brand/virtual-rudra-logo.png?v=2"
              unoptimized
              width={56}
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
          <span className="vr-menu-header-note">
            <i aria-hidden="true" />
            Freshly made, always
          </span>
        </header>

        {tableId !== null && tableNumber ? (
          <div className="vr-menu-table-notice">
            <span>ORDERING AT</span>
            <strong>Table {tableNumber}</strong>
          </div>
        ) : tableId !== null && data ? (
          <div className="vr-menu-table-notice is-invalid" role="status">
            <strong>Table not recognized</strong>
            <span>Please ask a team member for assistance.</span>
          </div>
        ) : null}

        {page === "menu" && <section aria-labelledby="menu-title" className="vr-menu-intro">
          <p className="vr-menu-eyebrow">A MENU FOR EVERY MOOD</p>
          <h1 id="menu-title">
            Good food.
            <br />
            <span>Great moments.</span>
          </h1>
          <p className="vr-menu-description">
            Discover something delicious, thoughtfully prepared and ready to be
            enjoyed.
          </p>
          <label className="vr-menu-search">
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <circle cx="10.8" cy="10.8" r="6.8" />
              <path d="m16 16 4.2 4.2" />
            </svg>
            <input
              aria-label="Search menu"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search dishes or categories"
              type="search"
              value={search}
            />
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
          </label>
        </section>}

        {page === "menu" && data && (
          <nav aria-label="Menu categories" className="vr-menu-filters">
            <button
              aria-pressed={selectedCategory === "all"}
              className={selectedCategory === "all" ? "is-selected" : ""}
              onClick={() => setSelectedCategory("all")}
              type="button"
            >
              All dishes <span>{data.menuItems.length}</span>
            </button>
            {categories.map((category) => (
              <button
                aria-pressed={selectedCategory === category.id}
                className={selectedCategory === category.id ? "is-selected" : ""}
                key={category.id}
                onClick={() => setSelectedCategory(category.id)}
                type="button"
              >
                {category.name}
                <span>{itemCounts.get(category.id) ?? 0}</span>
              </button>
            ))}
          </nav>
        )}

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
                  {cartItems.map(({ item, quantity, isUnavailable }) => (
                    <li className="vr-menu-cart-item" key={item.id}>
                      <div className="vr-menu-cart-thumbnail">
                        {item.imageUrl ? (
                          <Image
                            alt={item.name}
                            fill
                            sizes="(max-width: 700px) 76px, 88px"
                            src={item.imageUrl}
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
                  ))}
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
            className="vr-menu-confirmation"
            role="status"
          >
            <span aria-hidden="true" className="vr-menu-confirmation-icon">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="m6 12.5 4 4 8-9" />
              </svg>
            </span>
            <p className="vr-menu-category-kicker">ORDER CONFIRMED</p>
            <h2 id="order-confirmation-title">Thank You for Your Order!</h2>
            <p className="vr-menu-confirmation-message">
              Your order has been placed successfully
            </p>
            <dl className="vr-menu-confirmation-details">
              <div>
                <dt>Order number</dt>
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
            </dl>
            <div className="vr-menu-checkout-summary">
              <h3>Items</h3>
              <ul>
                {orderConfirmation.items.map((item) => (
                  <li key={item.itemId}>
                    <span>{item.name} × {item.quantity}</span>
                    <strong>{formatINR.format(item.unitPrice * item.quantity)}</strong>
                  </li>
                ))}
              </ul>
            </div>
            <form
              aria-labelledby="feedback-title"
              className="w-full max-w-[440px] rounded-xl border border-[#30343d] bg-[#12151a] p-4 text-left sm:p-5"
              onSubmit={handleFeedbackSubmit}
            >
              <h3 className="text-sm font-semibold text-[#f3f4f6]" id="feedback-title">
                How was your experience?
              </h3>
              <p className="mt-1 text-xs text-[#9a9faa]">
                Your feedback helps us improve.
              </p>
              <fieldset className="mt-4">
                <legend className="mb-2 text-xs font-medium text-[#c1c3c9]">
                  Rating
                </legend>
                <div className="flex gap-2" role="group" aria-label="Rate your experience">
                  {[1, 2, 3, 4, 5].map((rating) => (
                    <button
                      aria-label={`${rating} ${rating === 1 ? "star" : "stars"}`}
                      aria-pressed={feedbackRating === rating}
                      className={`grid size-10 place-items-center rounded-lg border text-xl transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ffad70] ${
                        feedbackRating >= rating
                          ? "border-[#c65c20] bg-[#382216] text-[#ffad70]"
                          : "border-[#30343d] text-[#777e89] hover:border-[#c65c20]"
                      }`}
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
              <label className="mt-4 block text-xs font-medium text-[#c1c3c9]" htmlFor="customer-feedback-comment">
                Comment <span className="font-normal text-[#888d98]">(optional)</span>
              </label>
              <textarea
                className="mt-2 min-h-24 w-full resize-y rounded-lg border border-[#30343d] bg-[#0d0f12] px-3 py-2 text-sm text-[#f3f4f6] outline-none placeholder:text-[#777e89] focus:border-[#f97316] disabled:opacity-70"
                disabled={feedbackSubmitting || Boolean(feedbackMessage)}
                id="customer-feedback-comment"
                maxLength={1000}
                onChange={(event) => setFeedbackComment(event.target.value)}
                placeholder="Tell us about your visit"
                value={feedbackComment}
              />
              {feedbackError && (
                <p className="mt-3 text-xs text-[#ff958a]" role="alert">
                  {feedbackError}
                </p>
              )}
              {feedbackMessage && (
                <p className="mt-3 text-xs text-[#4ade80]" role="status">
                  {feedbackMessage}
                </p>
              )}
              <button
                className="mt-4 inline-flex min-h-10 items-center justify-center rounded-lg bg-[#f97316] px-4 text-xs font-semibold text-white transition hover:bg-[#ea580c] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={feedbackSubmitting || Boolean(feedbackMessage)}
                type="submit"
              >
                {feedbackSubmitting ? "Saving feedback…" : "Submit feedback"}
              </button>
            </form>
            <Link
              className="vr-menu-place-order"
              href={`/track/${orderConfirmation.trackingToken}`}
              prefetch={false}
            >
              Track your order
            </Link>
            <Link className="vr-menu-place-order" href={tableHref("/menu")}>
              Back to Menu
            </Link>
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
            aria-labelledby="checkout-title"
            className="vr-menu-checkout"
            onSubmit={handleCheckout}
          >
            <div className="vr-menu-cart-heading">
              <div>
                <p className="vr-menu-category-kicker">ALMOST THERE</p>
                <h2 id="checkout-title">Checkout</h2>
              </div>
              <Link href={tableHref("/cart")}>Back to cart</Link>
            </div>
            <div className="vr-menu-checkout-fields">
              <p className="vr-menu-checkout-step">01 <span>YOUR DETAILS</span></p>
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
            <div aria-label="Order summary" className="vr-menu-checkout-summary">
              <div className="vr-menu-checkout-summary-heading">
                <div>
                  <p className="vr-menu-checkout-step">02 <span>REVIEW</span></p>
                  <h3>Your order</h3>
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
                  {cartItems.map(({ item, quantity }) => (
                    <li key={item.id}>
                      <span>
                        <strong>{item.name}</strong>
                        <small>
                          {hasUnavailableItems && !item.isAvailable
                            ? "Unavailable · remove from cart"
                            : `Qty ${quantity} × ${formatINR.format(item.priceINR)}`}
                        </small>
                      </span>
                      <strong>
                        {!item.isAvailable
                          ? "Unavailable"
                          : formatINR.format(item.priceINR * quantity)}
                      </strong>
                    </li>
                  ))}
                </ul>
              )}
              <div className="vr-menu-checkout-total">
                <span>Total</span>
                <strong>
                  {formatINR.format(orderConfirmation?.total ?? subtotal)}
                </strong>
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
              {isSubmittingOrder ? "Submitting Order…" : "Place Order"}
              {!isSubmittingOrder && <span aria-hidden="true">→</span>}
            </button>
          </form>
        )}

        {page === "menu" && <div className="vr-menu-results">
          {loadError ? (
            <p className="vr-menu-message" role="alert">{loadError}</p>
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
                <p>{selectedCategory === "all" ? "EXPLORE THE MENU" : "YOUR SELECTION"}</p>
                <span>{resultCount} {resultCount === 1 ? "dish" : "dishes"}</span>
              </div>
              {groups.map(({ category, items }) => (
                <section
                  aria-labelledby={`category-${category.id}`}
                  className="vr-menu-category"
                  key={category.id}
                >
                  <div className="vr-menu-category-heading">
                    <div>
                      <p className="vr-menu-category-kicker">MADE WITH CARE</p>
                      <h2 id={`category-${category.id}`}>{category.name}</h2>
                      {category.description && <p>{category.description}</p>}
                    </div>
                    <span>{items.length.toString().padStart(2, "0")}</span>
                  </div>
                  <div className="vr-menu-grid">
                    {items.map((item) => {
                      const quantity =
                        cart.find((line) => line.itemId === item.id)?.quantity ?? 0;
                      return (
                        <article
                          className={`vr-menu-card vr-menu-item-card${item.isAvailable ? "" : " is-unavailable"}`}
                          key={item.id}
                        >
                          <div className="vr-menu-photo">
                            {item.imageUrl ? (
                              <Image
                                alt=""
                                fill
                                sizes="(max-width: 700px) calc(100vw - 32px), (max-width: 1280px) 50vw, 600px"
                                src={item.imageUrl}
                                unoptimized
                              />
                            ) : (
                              <span aria-hidden="true" className="vr-menu-photo-mark">VR</span>
                            )}
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
                              <h3>{item.name}</h3>
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
                                  onClick={() => addToCart(item)}
                                  type="button"
                                >
                                  {item.isAvailable ? "Add" : "Unavailable"}
                                </button>
                              )}
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}
            </>
          )}
        </div>}
        <footer className="vr-menu-footer">
          <Image
            alt=""
            className="vr-menu-brand-mark"
            height={28}
            src="/brand/virtual-rudra-logo.png?v=2"
            unoptimized
            width={38}
          />
          <p>Virtual Rudra <span>·</span> Made for memorable meals</p>
        </footer>
        <nav aria-label="Mobile order navigation" className="vr-menu-mobile-nav">
          <Link aria-current={page === "menu" ? "page" : undefined} href={tableHref("/menu")}>
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
