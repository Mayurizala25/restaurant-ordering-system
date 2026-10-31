export type DemoCategory = {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  isActive: boolean;
  sortOrder: number;
};

export type DemoMenuItem = {
  id: string;
  name: string;
  description: string;
  priceINR: number;
  imageUrl: string;
  categoryId: DemoCategory["id"];
  isAvailable: boolean;
};

export type DemoTable = {
  id: string;
  tableNumber: number;
  name: string;
  seatingCapacity: number;
  isActive: boolean;
};

export type DemoData = {
  categories: DemoCategory[];
  menuItems: DemoMenuItem[];
  tables: DemoTable[];
};

export const initialDemoData: DemoData = {
  tables: [
    { id: "table-01", tableNumber: 1, name: "The Courtyard", seatingCapacity: 4, isActive: true },
    { id: "table-02", tableNumber: 2, name: "Window Table", seatingCapacity: 2, isActive: true },
    { id: "table-03", tableNumber: 3, name: "Garden View", seatingCapacity: 4, isActive: true },
    { id: "table-04", tableNumber: 4, name: "Family Corner", seatingCapacity: 6, isActive: true },
    { id: "table-05", tableNumber: 5, name: "Rudra Lounge", seatingCapacity: 4, isActive: true },
    { id: "table-06", tableNumber: 6, name: "Private Dining", seatingCapacity: 8, isActive: true },
    { id: "table-07", tableNumber: 7, name: "Patio Table", seatingCapacity: 4, isActive: true },
    { id: "table-08", tableNumber: 8, name: "Chef's Table", seatingCapacity: 2, isActive: true },
    { id: "table-09", tableNumber: 9, name: "Banquet Table", seatingCapacity: 10, isActive: false },
    { id: "table-10", tableNumber: 10, name: "The Nook", seatingCapacity: 2, isActive: false },
  ],
  categories: [
    {
      id: "cat-starters",
      name: "Starters",
      description: "Small plates and appetisers to start your meal.",
      imageUrl:
        "https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=800&q=80",
      isActive: true,
      sortOrder: 1,
    },
    {
      id: "cat-main-course",
      name: "Main Course",
      description: "Freshly prepared Indian favourites and hearty mains.",
      imageUrl:
        "https://images.unsplash.com/photo-1631452180519-c014fe946bc7?auto=format&fit=crop&w=800&q=80",
      isActive: true,
      sortOrder: 2,
    },
    {
      id: "cat-breads-rice",
      name: "Breads & Rice",
      description: "Made-to-order breads and fragrant rice dishes.",
      imageUrl:
        "https://images.unsplash.com/photo-1516714435131-44d6b64dc6a2?auto=format&fit=crop&w=800&q=80",
      isActive: true,
      sortOrder: 3,
    },
    {
      id: "cat-desserts",
      name: "Desserts",
      description: "Traditional sweets and indulgent desserts.",
      imageUrl:
        "https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=800&q=80",
      isActive: true,
      sortOrder: 4,
    },
    {
      id: "cat-beverages",
      name: "Beverages",
      description: "Refreshing drinks, chai, and coolers.",
      imageUrl:
        "https://images.unsplash.com/photo-1517701604599-bb29b565090c?auto=format&fit=crop&w=800&q=80",
      isActive: true,
      sortOrder: 5,
    },
    {
      id: "cat-breakfast",
      name: "Breakfast",
      description: "Breakfast dishes and morning favourites.",
      imageUrl: "",
      isActive: true,
      sortOrder: 6,
    },
    {
      id: "cat-brunch",
      name: "Brunch",
      description: "Relaxed late-morning plates and brunch favourites.",
      imageUrl: "",
      isActive: true,
      sortOrder: 7,
    },
    {
      id: "cat-lunch",
      name: "Lunch",
      description: "Freshly prepared dishes for lunch.",
      imageUrl: "",
      isActive: true,
      sortOrder: 8,
    },
    {
      id: "cat-dinner",
      name: "Dinner",
      description: "Evening meals and dinner favourites.",
      imageUrl: "",
      isActive: true,
      sortOrder: 9,
    },
    {
      id: "cat-pizza",
      name: "Pizza",
      description: "Oven-baked pizzas and savoury toppings.",
      imageUrl: "",
      isActive: true,
      sortOrder: 10,
    },
    {
      id: "cat-pasta",
      name: "Pasta",
      description: "Pasta dishes prepared with house sauces.",
      imageUrl: "",
      isActive: true,
      sortOrder: 11,
    },
    {
      id: "cat-north-indian",
      name: "North Indian",
      description: "North Indian dishes and regional favourites.",
      imageUrl: "",
      isActive: true,
      sortOrder: 12,
    },
    {
      id: "cat-south-indian",
      name: "South Indian",
      description: "South Indian dishes and regional favourites.",
      imageUrl: "",
      isActive: true,
      sortOrder: 13,
    },
    {
      id: "cat-chinese",
      name: "Chinese",
      description: "Chinese-inspired dishes and favourites.",
      imageUrl: "",
      isActive: true,
      sortOrder: 14,
    },
    {
      id: "cat-snacks",
      name: "Snacks",
      description: "Small bites and snacks for any time.",
      imageUrl: "",
      isActive: true,
      sortOrder: 15,
    },
  ],
  menuItems: [
    {
      id: "item-paneer-tikka",
      name: "Tandoori Paneer Tikka",
      description:
        "Char-grilled paneer with peppers, hung curd, and house-ground spices.",
      priceINR: 289,
      imageUrl:
        "https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?auto=format&fit=crop&w=800&q=80",
      categoryId: "cat-starters",
      isAvailable: true,
    },
    {
      id: "item-samosa",
      name: "Punjabi Samosa",
      description:
        "Crisp pastry filled with spiced potato and peas, served with chutney.",
      priceINR: 149,
      imageUrl:
        "https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=800&q=80",
      categoryId: "cat-starters",
      isAvailable: true,
    },
    {
      id: "item-butter-chicken",
      name: "Murgh Makhani",
      description:
        "Tandoor-roasted chicken simmered in a rich tomato and butter gravy.",
      priceINR: 429,
      imageUrl:
        "https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?auto=format&fit=crop&w=800&q=80",
      categoryId: "cat-main-course",
      isAvailable: true,
    },
    {
      id: "item-paneer-butter-masala",
      name: "Paneer Butter Masala",
      description:
        "Soft paneer in a creamy tomato gravy finished with kasuri methi.",
      priceINR: 349,
      imageUrl:
        "https://images.unsplash.com/photo-1631452180519-c014fe946bc7?auto=format&fit=crop&w=800&q=80",
      categoryId: "cat-main-course",
      isAvailable: true,
    },
    {
      id: "item-dal-makhani",
      name: "Dal Makhani",
      description:
        "Slow-cooked black lentils finished with butter and fresh cream.",
      priceINR: 299,
      imageUrl:
        "https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&w=800&q=80",
      categoryId: "cat-main-course",
      isAvailable: false,
    },
    {
      id: "item-garlic-naan",
      name: "Garlic Naan",
      description: "Tandoor-baked naan brushed with butter and fresh garlic.",
      priceINR: 79,
      imageUrl:
        "https://images.unsplash.com/photo-1601050690117-94f5f6fa8bd7?auto=format&fit=crop&w=800&q=80",
      categoryId: "cat-breads-rice",
      isAvailable: true,
    },
    {
      id: "item-jeera-rice",
      name: "Jeera Rice",
      description: "Steamed basmati rice tempered with cumin and ghee.",
      priceINR: 169,
      imageUrl:
        "https://images.unsplash.com/photo-1516684732162-798a0062be99?auto=format&fit=crop&w=800&q=80",
      categoryId: "cat-breads-rice",
      isAvailable: true,
    },
    {
      id: "item-gulab-jamun",
      name: "Gulab Jamun",
      description: "Warm milk dumplings soaked in cardamom-scented syrup.",
      priceINR: 129,
      imageUrl:
        "https://images.unsplash.com/photo-1666190092159-0630d9c7d10d?auto=format&fit=crop&w=800&q=80",
      categoryId: "cat-desserts",
      isAvailable: true,
    },
    {
      id: "item-masala-chai",
      name: "Masala Chai",
      description: "Freshly brewed tea simmered with milk and warming spices.",
      priceINR: 59,
      imageUrl:
        "https://images.unsplash.com/photo-1571934811356-5cc061b6821f?auto=format&fit=crop&w=800&q=80",
      categoryId: "cat-beverages",
      isAvailable: true,
    },
  ],
};
