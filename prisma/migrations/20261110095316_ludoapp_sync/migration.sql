-- AlterTable
ALTER TABLE `User` ADD COLUMN `ludoAppUserId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `LudoAppAccountCache` (
    `id` VARCHAR(191) NOT NULL,
    `identifiant` VARCHAR(191) NOT NULL,
    `nom` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `role` VARCHAR(191) NOT NULL,
    `actif` BOOLEAN NOT NULL,
    `fetchedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LudoAppSync` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `lastSuccessAt` DATETIME(3) NULL,
    `lastAttemptAt` DATETIME(3) NULL,
    `lastError` TEXT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `User_ludoAppUserId_key` ON `User`(`ludoAppUserId`);
