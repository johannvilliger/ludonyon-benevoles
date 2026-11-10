-- AlterTable
ALTER TABLE `OpeningShift` ADD COLUMN `unfilledAlertSentAt` DATETIME(3) NULL,
    ADD COLUMN `callLaunchedAt` DATETIME(3) NULL,
    ADD COLUMN `callLaunchedById` VARCHAR(191) NULL;

-- AddForeignKey
ALTER TABLE `OpeningShift` ADD CONSTRAINT `OpeningShift_callLaunchedById_fkey` FOREIGN KEY (`callLaunchedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
