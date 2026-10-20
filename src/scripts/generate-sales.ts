import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DATA_DIR } from "../config.ts";

type Region = { name: string; factor: number };
type Product = { name: string; baseAmount: number; baseQuantity: number };

const regions: Region[] = [
  { name: "华东", factor: 1.00 },
  { name: "华南", factor: 1.08 },
  { name: "华北", factor: 0.94 },
];

const products: Product[] = [
  { name: "笔记本电脑", baseAmount: 50000, baseQuantity: 16 },
  { name: "手机", baseAmount: 30000, baseQuantity: 22 },
  { name: "平板电脑", baseAmount: 16000, baseQuantity: 10 },
];

const monthFactors = [0.92, 1.00, 1.07, 1.04, 1.10, 0.98, 1.14, 1.09, 0.96, 1.16, 1.27, 1.34];
const people: Record<string, string[]> = {
  "笔记本电脑": ["张伟", "张伟", "王强"],
  "手机": ["刘芳", "李娜", "刘芳"],
  "平板电脑": ["刘芳", "李娜", "王强"],
};

function roundToHundred(value: number): number {
  return Math.round(value / 100) * 100;
}

const rows = ["日期,产品,地区,销售额,数量,销售人员"];
for (let month = 1; month <= 12; month += 1) {
  for (let regionIndex = 0; regionIndex < regions.length; regionIndex += 1) {
    const region = regions[regionIndex];
    for (let productIndex = 0; productIndex < products.length; productIndex += 1) {
      const product = products[productIndex];
      const seasonal = monthFactors[month - 1];
      const smallVariation = 1 + (((month * 7 + regionIndex * 3 + productIndex * 5) % 7) - 3) / 100;
      const amount = roundToHundred(product.baseAmount * region.factor * seasonal * smallVariation);
      const quantity = Math.max(1, Math.round(product.baseQuantity * region.factor * seasonal * smallVariation));
      const day = 3 + ((month * 5 + regionIndex * 7 + productIndex * 4) % 24);
      rows.push([
        `2024-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        product.name,
        region.name,
        String(amount),
        String(quantity),
        people[product.name][regionIndex],
      ].join(","));
    }
  }
}

const output = resolve(DATA_DIR, "sales.csv");
writeFileSync(output, `${rows.join("\n")}\n`, "utf8");
console.log(`已生成 ${rows.length - 1} 条销售记录：${output}`);

