-- AddForeignKey
ALTER TABLE "Movement" ADD CONSTRAINT "Movement_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
