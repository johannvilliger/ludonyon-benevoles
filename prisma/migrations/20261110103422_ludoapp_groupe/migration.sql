-- LudoApp est passé d'un rôle fixe (retour/complet/admin) à des groupes
-- de droits nommés et configurables (groupes_utilisateurs) — GET
-- /api/sync/comptes renvoie maintenant `groupe` (le nom du groupe) au
-- lieu de `role`.
-- AlterTable
ALTER TABLE `LudoAppAccountCache` CHANGE COLUMN `role` `groupe` VARCHAR(191) NOT NULL;
