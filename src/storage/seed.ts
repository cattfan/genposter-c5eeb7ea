import { nanoid } from "nanoid";
import { db } from "./db";
import type {
  Asset,
  Entity,
  PackTemplate,
  PageTemplate,
  Project,
  Slot,
} from "@/models";

const SEED_FLAG = "cpg_seeded_v1";

// Ảnh demo từ Unsplash (URL public, không cần download)
const IMG = {
  cafe1: "https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=900",
  cafe2: "https://images.unsplash.com/photo-1521017432531-fbd92d768814?w=900",
  food1: "https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=900",
  food2: "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=900",
  food3: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=900",
  homestay1: "https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=900",
  homestay2: "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=900",
  car1: "https://images.unsplash.com/photo-1502877338535-766e1452684a?w=900",
  checkin1: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=900",
  checkin2: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=900",
  spa1: "https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=900",
  bgCover: "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=1200",
  bgBoard: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=1200",
};

function makeEntity(p: Partial<Entity> & { name: string; categoryMain: string }): Entity {
  return {
    entityId: nanoid(),
    name: p.name,
    categoryMain: p.categoryMain,
    categorySub: p.categorySub,
    address: p.address,
    phone: p.phone,
    openingHours: p.openingHours,
    style: p.style,
    priceRange: p.priceRange,
    partnerFlag: p.partnerFlag ?? false,
    partnerPriority: p.partnerPriority ?? 0,
    partnerType: p.partnerType ?? "none",
    campaignTags: p.campaignTags ?? [],
    seoKeywords: p.seoKeywords ?? [],
    status: p.status ?? "active",
    sourceRowId: p.sourceRowId,
  };
}

function makeAsset(entityId: string, url: string, role: Asset["role"], isCover = false): Asset {
  return {
    assetId: nanoid(),
    entityId,
    sourceType: "url",
    sourceValue: url,
    role,
    isCover,
    qualityScore: 80,
    status: "ok",
    orientation: "landscape",
    aspectRatio: 4 / 3,
  };
}

export async function isSeeded(): Promise<boolean> {
  return localStorage.getItem(SEED_FLAG) === "1";
}

export async function seedDemo(force = false): Promise<void> {
  if (!force && (await isSeeded())) return;

  // Project
  const project: Project = {
    projectId: nanoid(),
    name: "Đà Lạt Demo Pack",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    description: "Project demo cho Content Pack Generator",
  };

  // Entities
  const entities: Entity[] = [
    makeEntity({
      name: "Cafe Mây Lang Thang",
      categoryMain: "cafe",
      categorySub: "view_dep",
      address: "12 Trần Phú, Đà Lạt",
      phone: "0905 111 222",
      priceRange: "40k - 80k",
      partnerFlag: true,
      partnerPriority: 90,
      partnerType: "sponsor",
      campaignTags: ["cafe_view", "checkin"],
      seoKeywords: ["cafe đà lạt", "view đẹp"],
    }),
    makeEntity({
      name: "Quán Bún Bò Ấm",
      categoryMain: "quan_an",
      categorySub: "bun_bo",
      address: "45 Phan Đình Phùng, Đà Lạt",
      phone: "0905 333 444",
      priceRange: "35k - 60k",
      partnerFlag: true,
      partnerPriority: 80,
      partnerType: "sponsor",
      campaignTags: ["dac_san"],
    }),
    makeEntity({
      name: "Bánh Tráng Nướng Cô Hoa",
      categoryMain: "quan_an",
      categorySub: "an_vat",
      address: "Chợ Đà Lạt",
      priceRange: "20k - 40k",
      campaignTags: ["dac_san"],
    }),
    makeEntity({
      name: "Lẩu Gà Lá É Tao Ngộ",
      categoryMain: "quan_an",
      categorySub: "lau",
      address: "5 Bùi Thị Xuân, Đà Lạt",
      priceRange: "150k - 250k",
      partnerFlag: true,
      partnerPriority: 75,
      partnerType: "campaign",
    }),
    makeEntity({
      name: "Homestay Trên Đồi",
      categoryMain: "homestay",
      address: "Đường Vòng Lâm Viên",
      priceRange: "500k - 900k/đêm",
      partnerFlag: true,
      partnerPriority: 85,
      partnerType: "sponsor",
    }),
    makeEntity({
      name: "Pine House Homestay",
      categoryMain: "homestay",
      address: "Hẻm 3, Trại Mát",
      priceRange: "400k - 700k/đêm",
    }),
    makeEntity({
      name: "Thuê Xe Máy An Tâm",
      categoryMain: "thue_xe",
      address: "Bến xe Đà Lạt",
      phone: "0909 555 666",
      priceRange: "120k - 180k/ngày",
      partnerFlag: true,
      partnerPriority: 70,
      partnerType: "sponsor",
    }),
    makeEntity({
      name: "Auto Đà Lạt - Thuê Xe Tự Lái",
      categoryMain: "thue_xe",
      address: "10 Hùng Vương",
      priceRange: "800k - 1.5tr/ngày",
    }),
    makeEntity({
      name: "Đồi Chè Cầu Đất",
      categoryMain: "checkin",
      address: "Cầu Đất, Đà Lạt",
      priceRange: "Free",
    }),
    makeEntity({
      name: "Hồ Tuyền Lâm",
      categoryMain: "checkin",
      address: "Phường 3, Đà Lạt",
      priceRange: "Free",
    }),
    makeEntity({
      name: "Spa Thư Giãn An Yên",
      categoryMain: "spa",
      address: "23 Nguyễn Công Trứ",
      priceRange: "200k - 400k",
    }),
    makeEntity({
      name: "Cafe The Wilder Nest",
      categoryMain: "cafe",
      categorySub: "khu_vuon",
      address: "Khu vực Tà Nung",
      priceRange: "50k - 90k",
    }),
  ];

  // Map name -> id
  const E = (name: string) => entities.find((e) => e.name === name)!.entityId;

  const assets: Asset[] = [
    makeAsset(E("Cafe Mây Lang Thang"), IMG.cafe1, "cover", true),
    makeAsset(E("Cafe Mây Lang Thang"), IMG.cafe2, "space"),
    makeAsset(E("Quán Bún Bò Ấm"), IMG.food1, "food_closeup", true),
    makeAsset(E("Quán Bún Bò Ấm"), IMG.food2, "food_closeup"),
    makeAsset(E("Bánh Tráng Nướng Cô Hoa"), IMG.food3, "food_closeup", true),
    makeAsset(E("Lẩu Gà Lá É Tao Ngộ"), IMG.food1, "food_closeup", true),
    makeAsset(E("Homestay Trên Đồi"), IMG.homestay1, "facade", true),
    makeAsset(E("Homestay Trên Đồi"), IMG.homestay2, "space"),
    makeAsset(E("Pine House Homestay"), IMG.homestay2, "facade", true),
    makeAsset(E("Thuê Xe Máy An Tâm"), IMG.car1, "facade", true),
    makeAsset(E("Auto Đà Lạt - Thuê Xe Tự Lái"), IMG.car1, "facade", true),
    makeAsset(E("Đồi Chè Cầu Đất"), IMG.checkin1, "cover", true),
    makeAsset(E("Hồ Tuyền Lâm"), IMG.checkin2, "cover", true),
    makeAsset(E("Spa Thư Giãn An Yên"), IMG.spa1, "space", true),
    makeAsset(E("Cafe The Wilder Nest"), IMG.cafe2, "cover", true),
  ];

  // Templates
  const coverTpl = makeCoverTemplate();
  const itineraryTpl = makeItineraryTemplate();
  const boardTpl = makeBoardTemplate();

  const pack: PackTemplate = {
    packTemplateId: nanoid(),
    name: "Pack Đà Lạt Cuối Tuần",
    goal: "Gợi ý 1 chuyến đi Đà Lạt 2N1Đ",
    tone: "trẻ trung, gen-z, lưu lại để đi",
    cta: "Lưu lại để đi nhé!",
    orderedPages: [coverTpl.pageTemplateId, itineraryTpl.pageTemplateId, boardTpl.pageTemplateId],
    requiredPages: [coverTpl.pageTemplateId],
    optionalPages: [],
    captionProfile: { mode: "save_post", seoKeywords: ["đà lạt", "review đà lạt"] },
    exportDefaults: { format: "png", scale: 2 },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await db.transaction(
    "rw",
    [db.projects, db.entities, db.assets, db.pageTemplates, db.packTemplates],
    async () => {
      await db.projects.put(project);
      await db.entities.bulkPut(entities);
      await db.assets.bulkPut(assets);
      await db.pageTemplates.bulkPut([coverTpl, itineraryTpl, boardTpl]);
      await db.packTemplates.put(pack);
    },
  );

  localStorage.setItem(SEED_FLAG, "1");
}

function makeSlot(s: Partial<Slot> & Pick<Slot, "kind" | "x" | "y" | "width" | "height">): Slot {
  return {
    slotId: nanoid(),
    rotation: 0,
    zIndex: 1,
    ...s,
  } as Slot;
}

function makeCoverTemplate(): PageTemplate {
  return {
    pageTemplateId: nanoid(),
    name: "Trang bìa - Cover Đà Lạt",
    type: "cover",
    canvas: { width: 1080, height: 1350, background: "#0a0a0a" },
    slots: [
      makeSlot({
        kind: "image",
        x: 0,
        y: 0,
        width: 1080,
        height: 1350,
        staticImage: IMG.bgCover,
        zIndex: 0,
        style: { fit: "cover", overlayColor: "rgba(0,0,0,0.45)" },
      }),
      makeSlot({
        kind: "text",
        x: 60,
        y: 200,
        width: 960,
        height: 100,
        staticText: "REVIEW ĐÀ LẠT",
        zIndex: 2,
        style: {
          fontFamily: "'Be Vietnam Pro', sans-serif",
          fontSize: 36,
          fontWeight: 700,
          color: "#fde68a",
          textAlign: "center",
          letterSpacing: 8,
          textTransform: "uppercase",
        },
      }),
      makeSlot({
        kind: "text",
        x: 60,
        y: 320,
        width: 960,
        height: 400,
        staticText: "ĐI ĐÀ LẠT 2N1Đ\nKHÔNG CẦN NGHĨ NHIỀU",
        zIndex: 2,
        style: {
          fontFamily: "'Be Vietnam Pro', sans-serif",
          fontSize: 96,
          fontWeight: 900,
          color: "#ffffff",
          textAlign: "center",
          lineHeight: 1.1,
          textTransform: "uppercase",
        },
      }),
      makeSlot({
        kind: "text",
        x: 60,
        y: 1180,
        width: 960,
        height: 60,
        staticText: "Lưu lại để đi cuối tuần này nhé!",
        zIndex: 2,
        style: {
          fontFamily: "'Be Vietnam Pro', sans-serif",
          fontSize: 32,
          fontWeight: 500,
          color: "#fde68a",
          textAlign: "center",
        },
      }),
    ],
    sections: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function makeItineraryTemplate(): PageTemplate {
  const sectionId = nanoid();
  return {
    pageTemplateId: nanoid(),
    name: "Lịch trình ngày 1 - Itinerary",
    type: "itinerary",
    canvas: { width: 1080, height: 1350, background: "#fef3c7" },
    slots: [
      makeSlot({
        kind: "shape",
        shapeKind: "rectangle",
        x: 0,
        y: 0,
        width: 1080,
        height: 180,
        zIndex: 0,
        style: { fill: "#0f172a" },
      }),
      makeSlot({
        kind: "text",
        x: 60,
        y: 60,
        width: 960,
        height: 80,
        staticText: "NGÀY 1 — KHÁM PHÁ ĐÀ LẠT",
        zIndex: 2,
        style: {
          fontFamily: "'Be Vietnam Pro', sans-serif",
          fontSize: 56,
          fontWeight: 800,
          color: "#fde68a",
          textAlign: "left",
          textTransform: "uppercase",
        },
      }),
      makeSlot({
        kind: "section",
        sectionRefId: sectionId,
        x: 60,
        y: 230,
        width: 960,
        height: 1060,
        zIndex: 1,
      }),
    ],
    sections: [
      {
        sectionId,
        title: "Ăn uống & checkin",
        categoryQuery: "quan_an,cafe,checkin",
        maxItems: 5,
        minItems: 3,
        imageMode: "anchor_entity",
        listStyle: "number",
        sortRule: "partner_first",
        partnerMode: "priority_partner",
        overflowPolicy: "ellipsis",
      },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function makeBoardTemplate(): PageTemplate {
  const s1 = nanoid();
  const s2 = nanoid();
  const s3 = nanoid();
  return {
    pageTemplateId: nanoid(),
    name: "Board mixed - Homestay & Thuê xe & Spa",
    type: "board",
    canvas: { width: 1080, height: 1350, background: "#fffbeb" },
    slots: [
      makeSlot({
        kind: "text",
        x: 60,
        y: 50,
        width: 960,
        height: 70,
        staticText: "Ở ĐÂU - DI CHUYỂN - THƯ GIÃN",
        zIndex: 2,
        style: {
          fontFamily: "'Be Vietnam Pro', sans-serif",
          fontSize: 40,
          fontWeight: 800,
          color: "#0f172a",
          textAlign: "center",
          textTransform: "uppercase",
        },
      }),
      makeSlot({
        kind: "section",
        sectionRefId: s1,
        x: 60,
        y: 150,
        width: 960,
        height: 380,
        zIndex: 1,
      }),
      makeSlot({
        kind: "section",
        sectionRefId: s2,
        x: 60,
        y: 550,
        width: 960,
        height: 380,
        zIndex: 1,
      }),
      makeSlot({
        kind: "section",
        sectionRefId: s3,
        x: 60,
        y: 950,
        width: 960,
        height: 360,
        zIndex: 1,
      }),
    ],
    sections: [
      {
        sectionId: s1,
        title: "🏡 Homestay đẹp",
        categoryQuery: "homestay",
        maxItems: 2,
        minItems: 1,
        imageMode: "anchor_entity",
        listStyle: "dot",
        sortRule: "partner_first",
        partnerMode: "priority_partner",
      },
      {
        sectionId: s2,
        title: "🛵 Thuê xe tiện lợi",
        categoryQuery: "thue_xe",
        maxItems: 2,
        minItems: 1,
        imageMode: "anchor_entity",
        listStyle: "dot",
        sortRule: "partner_first",
        partnerMode: "priority_partner",
      },
      {
        sectionId: s3,
        title: "💆 Thư giãn",
        categoryQuery: "spa",
        maxItems: 2,
        minItems: 1,
        imageMode: "anchor_entity",
        listStyle: "dot",
        sortRule: "diversity",
        partnerMode: "balanced_partner",
      },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
