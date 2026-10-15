import { Router, Request, Response } from "express";
import {
  getAllProductsDetails,
  getProductDetails,
  updateProductDetails,
  createNewProduct,
} from "./products-service.js";

export function createProductsRouter(): Router {
  const router = Router();

  // GET /api/products - list all products
  router.get("/", (_req: Request, res: Response) => {
    try {
      const products = getAllProductsDetails();
      res.set("Cache-Control", "no-store").json({
        success: true,
        count: products.length,
        products,
      });
    } catch (err) {
      console.error("[Products GET Error]", err);
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  // GET /api/products/:id - get single product details
  router.get("/:id", (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const product = getProductDetails(id);
      if (!product) {
        return res.status(404).json({ success: false, error: `Product "${id}" not found.` });
      }
      res.set("Cache-Control", "no-store").json({ success: true, product });
    } catch (err) {
      console.error("[Product GET Error]", err);
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  // POST /api/products - create new product
  router.post("/", (req: Request, res: Response) => {
    try {
      const { id, name, keywords, homepage, description, voice, guidance, reviewThreshold } = req.body || {};
      if (!id) {
        return res.status(400).json({ success: false, error: "Product id/key is required." });
      }
      if (!name) {
        return res.status(400).json({ success: false, error: "Product name is required." });
      }
      const product = createNewProduct({
        id,
        name,
        keywords,
        homepage,
        description,
        voice,
        guidance,
        reviewThreshold,
      });
      res.status(201).json({
        success: true,
        message: `Product "${product.name}" created successfully.`,
        product,
      });
    } catch (err) {
      console.error("[Product Create Error]", err);
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  });

  // PUT /api/products/:id - update existing product keywords & params
  router.put("/:id", (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const updated = updateProductDetails(id, req.body || {});
      res.json({
        success: true,
        message: `Updated product "${updated.name}" successfully.`,
        product: updated,
      });
    } catch (err) {
      console.error("[Product Update Error]", err);
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  });

  // POST /api/products/:id - support POST for clients that prefer POST over PUT
  router.post("/:id", (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const updated = updateProductDetails(id, req.body || {});
      res.json({
        success: true,
        message: `Updated product "${updated.name}" successfully.`,
        product: updated,
      });
    } catch (err) {
      console.error("[Product Update Error]", err);
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  });

  return router;
}

export const productsRouter = createProductsRouter();

