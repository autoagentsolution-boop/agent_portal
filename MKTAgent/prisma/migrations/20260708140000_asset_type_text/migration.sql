-- Fix D: text-only posts. Add a 'text' AssetType so a copy-only post (no media) publishes
-- to FB/X/LinkedIn/Threads instead of failing the publisher's "no asset (image)" validation.
ALTER TYPE "AssetType" ADD VALUE IF NOT EXISTS 'text';
