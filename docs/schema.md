# book-me-up — data model

Source of truth for the domain model. Written in Eraser-style DBML.
Update this file first when the model changes, then propagate to migrations.

```
// table to store barber's data as the user. separate from what is shown
// online. this is private and never sees the web
User [icon: user, color: green] {
  id String pk
  email String unique
  hashedPassword String?  // nullable: OAuth / Supabase Auth
  firstName String
  lastName String
  phone String?
  isPlatformAdmin Boolean  // the only non-derivable role
  createdAt DateTime
  updatedAt DateTime
}

// Info for the actual physical shop
Establishment [icon: home, color: blue] {
  id String pk
  slug String unique
  name String
  address String
  city String
  state String
  zip String
  lat Float?
  lng Float?
  timezone String
  phone String?
  email String?
  hours Json?
  description String
  images String[]
  isActive Boolean
  createdAt DateTime
  updatedAt DateTime
}

// ties in an establishment with an owner, many rows for many owners
EstablishmentOwner [icon: key, color: blue] {
  id String pk
  userId String fk
  establishmentId String fk
  canManageBilling Boolean // might not be necessary
  createdAt DateTime
}
// unique (userId, establishmentId)

// barber's info to display on the web. this would go on their own booking
// site or the establishment's landing page
WorkerProfile [icon: user-check, color: yellow] {
  id String pk
  userId String fk // ties to "User" table that holds personal data
  slug String unique
  firstName String
  lastName String
  bio String
  publicEmail String?
  publicPhone String?
  image String?
  isActive Boolean

  // booking policy
  holdExpiryHours Int // 24 hr by default, this is the time that can pass by
                      // for a PENDING appointment, after that it goes from
                      // PENDING -> SYSTEM
  autoAccept Boolean
  minLeadTimeMin Int
  maxAdvanceDays Int
  cancellationCutoffMin Int
  createdAt DateTime
  updatedAt DateTime
}

// makes it so workers can work at more than one shop
WorkerEstablishment [icon: link, color: yellow] {
  id String pk
  workerId String fk
  establishmentId String fk
  isActive Boolean
  createdAt DateTime
  updatedAt DateTime
  startedAt DateTime
  endedAt DateTime?
  // unique (workerId, establishmentId) where isActive
}

// one per day, breaks are now included
WorkerScheduleDay [icon: calendar, color: yellow] {
  id String pk
  workerEstablishmentId String fk  // scoped to the chair, not the person
  dayOfWeek Int    // 0 = Sunday, 6 = Saturday
  startMinute Int  // 0-1440, local to establishment.timezone
  endMinute Int
  breakStartMinute Int? // they can choose when to
  breakEndMinute Int?   // take a break, eg 12-1
  createdAt DateTime
  updatedAt DateTime
}

// blocks out everywhere. if they work 2 shops, both shops get blocked off
WorkerTimeOff [icon: bed, color: yellow] {
  id String pk
  workerId String fk
  starts DateTime
  ends DateTime
  reason String?
  createdAt DateTime
  updatedAt DateTime
}

// service object, one per service. this translates to all shops if they
// offer them.
Service [icon: scissors, color: red] {
  id String pk
  workerId String fk  // owned by the chair, not the shop
  title String
  description String
  image String?
  priceCents Int
  durationMin Int
  bufferAfterMin Int  // barber sees this when booking
  isActive Boolean
  createdAt DateTime
  updatedAt DateTime
}

// object for when a client willingly makes an account. phone is left
// non-unique: what if a mom has 3 kids, they all go to the same shop, and
// she's the one that books the appointments
Client [icon: users, color: purple] {
  id String pk
  phone String  // E.164, the dedupe key
  email String?
  firstName String
  lastName String
  userId String? fk  // set if they ever make an account
  createdAt DateTime
  updatedAt DateTime
}

// attempts to save notes based on limited metadata
// in action, it would prefer clientId if non-null, else it tries to save any
// info onto the existing email or phone number. phone number should be
// required.
ClientNote [icon: file-text, color: purple] {
  id String pk
  clientId String? //fk sorta
  clientPhone String
  clientEmail String?
  workerId String fk
  body String
  createdAt DateTime
  updatedAt DateTime
}

// ================= BOOKING =================
Appointment [icon: calendar-check, color: green] {
  id String pk
  workerEstablishmentId String fk
  establishmentId String fk
  workerId String fk
  serviceId String fk  // analytics only, never join for display
  clientId String? fk  // fk sorta, same logic as above. this is preferred,
                       // fall back is the phone number

  startsAt DateTime
  endsAt DateTime       // client sees (start + end)
  blockEndsAt DateTime  // barber sees (start + end + buffer)

  // snapshots at booking time
  serviceTitle String
  priceCents Int
  durationMin Int
  bufferAfterMin Int

  status AppointmentStatus
  cancelledBy CancelledBy?
  holdExpiresAt DateTime?  // only set while PENDING

  clientName String
  clientPhone String
  clientEmail String?
  clientNotes String?  // client-authored, this booking only

  cancelledAt DateTime?
  cancellationReason String?

  createdAt DateTime
  updatedAt DateTime
}

// AppointmentStatus: PENDING | ACCEPTED | REJECTED | CANCELLED | COMPLETED | NO_SHOW
// CancelledBy: CLIENT | WORKER | SYSTEM

User.id < EstablishmentOwner.userId
Establishment.id < EstablishmentOwner.establishmentId

User.id - WorkerProfile.userId
WorkerProfile.id < WorkerEstablishment.workerId
Establishment.id < WorkerEstablishment.establishmentId

WorkerEstablishment.id < WorkerScheduleDay.workerEstablishmentId
WorkerProfile.id < WorkerTimeOff.workerId
WorkerProfile.id < Service.workerId

User.id < Client.userId
Client.id < ClientNote.clientId
WorkerProfile.id < ClientNote.workerId

Establishment.id < Appointment.establishmentId
WorkerProfile.id < Appointment.workerId
Service.id < Appointment.serviceId
Client.id < Appointment.clientId
WorkerEstablishment.id < Appointment.workerEstablishmentId
```
