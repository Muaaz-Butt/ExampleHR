import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum RequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

@Entity()
export class TimeOffRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  employeeId!: string;

  @Column()
  locationId!: string;

  @Column('real')
  days!: number;

  @Column()
  startDate!: string;

  @Column()
  endDate!: string;

  @Column({ type: 'varchar', default: RequestStatus.PENDING })
  status!: RequestStatus;

  @Column({ type: 'text', nullable: true })
  rejectionReason?: string;

  @CreateDateColumn()
  requestedAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
