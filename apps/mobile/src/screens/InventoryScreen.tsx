import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  ArrowLeft,
  BedDouble,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Coffee,
  Edit3,
  ImageIcon,
  ImagePlus,
  Plus,
  Star,
  Trash2,
  Users,
} from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import { theme } from "@hotel/design";
import { apiClient, authErrorMessage } from "@/api/client";
import type {
  BedType,
  MealPlan,
  RatePeriod,
  RatePeriodInput,
  RatePreview,
  Room,
  RoomInput,
} from "@/api/types";
import { Button, EmptyState, Field, InlineState, SectionTitle, uiStyles } from "@/components/ui";

type InventoryView = "list" | "roomForm" | "detail" | "rateForm";

type RoomPhotoDraft = {
  id: string;
  uri: string;
  uploadedUrl?: string;
  base64?: string;
  mimeType?: "image/jpeg" | "image/png";
};

export function InventoryScreen({ onBack }: { onBack: () => void }) {
  const [view, setView] = useState<InventoryView>("list");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [selectedRate, setSelectedRate] = useState<RatePeriod | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRooms = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      setRooms(await apiClient.listRooms());
    } catch (nextError) {
      setError(authErrorMessage(nextError));
    } finally {
      refresh ? setRefreshing(false) : setLoading(false);
    }
  }, []);

  useEffect(() => { void loadRooms(); }, [loadRooms]);

  const handleRoomSaved = (room: Room) => {
    setRooms((current) => {
      const exists = current.some((item) => item.id === room.id);
      return exists ? current.map((item) => item.id === room.id ? room : item) : [room, ...current];
    });
    setSelectedRoom(room);
    setView("detail");
  };

  if (view === "roomForm") {
    return (
      <RoomForm
        room={selectedRoom}
        onBack={() => setView(selectedRoom ? "detail" : "list")}
        onSaved={handleRoomSaved}
      />
    );
  }

  if (view === "rateForm" && selectedRoom) {
    return <RateForm room={selectedRoom} rate={selectedRate} onBack={() => setView("detail")} onSaved={() => setView("detail")} />;
  }

  if (view === "detail" && selectedRoom) {
    return (
      <RoomDetail
        room={selectedRoom}
        onBack={() => { setSelectedRoom(null); setView("list"); }}
        onEdit={() => setView("roomForm")}
        onAddRate={() => { setSelectedRate(null); setView("rateForm"); }}
        onEditRate={(rate) => { setSelectedRate(rate); setView("rateForm"); }}
      />
    );
  }

  return (
    <ScrollView
      style={uiStyles.screen}
      contentContainerStyle={styles.screenContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadRooms(true)} tintColor={theme.colors.action} />}
      showsVerticalScrollIndicator={false}
    >
      <ScreenHeader title="Rooms and rates" onBack={onBack} />
      <Text style={styles.lead}>Room categories, capacity and date-based pricing.</Text>

      {error ? (
        <View style={styles.stateGap}>
          <InlineState tone="danger">{error}</InlineState>
          <Button variant="secondary" onPress={() => void loadRooms()}>Try again</Button>
        </View>
      ) : loading ? (
        <LoadingState label="Loading rooms…" />
      ) : (
        <>
          <View style={styles.summaryCard}>
            <View style={styles.summaryIcon}><BedDouble size={22} color={theme.colors.action} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.summaryValue}>{rooms.length}</Text>
              <Text style={styles.summaryLabel}>{rooms.length === 1 ? "room category" : "room categories"}</Text>
            </View>
            <Button
              variant="tertiary"
              icon={Plus}
              onPress={() => { setSelectedRoom(null); setView("roomForm"); }}
            >
              Add
            </Button>
          </View>

          <View style={styles.section}>
            <SectionTitle>Catalogue</SectionTitle>
            {rooms.length === 0 ? (
              <View style={styles.emptyWrap}>
                <EmptyState title="Add your first room" description="Set its capacity and beds, then add date-based rates." />
                <Button onPress={() => { setSelectedRoom(null); setView("roomForm"); }} icon={Plus}>Create room</Button>
              </View>
            ) : (
              <View style={styles.list}>
                {rooms.map((room) => (
                  <Pressable
                    key={room.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${room.name}, up to ${room.maxGuests} guests`}
                    onPress={() => { setSelectedRoom(room); setView("detail"); }}
                    style={({ pressed }) => [uiStyles.card, styles.roomCard, pressed && styles.pressed]}
                  >
                    <RoomPhoto uri={room.photoUrls[0]} variant="card" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.roomName}>{room.name}</Text>
                      <Text numberOfLines={2} style={styles.roomDescription}>{room.description || "No description added yet"}</Text>
                      <View style={styles.compactMeta}>
                        <Users size={14} color={theme.colors.textMuted} />
                        <Text style={styles.compactMetaText}>up to {room.maxGuests} · {bedSummary(room)}</Text>
                      </View>
                    </View>
                    <ChevronRight size={20} color={theme.colors.textMuted} />
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

function RoomForm({ room, onBack, onSaved }: { room: Room | null; onBack: () => void; onSaved: (room: Room) => void }) {
  const [name, setName] = useState(room?.name ?? "");
  const [description, setDescription] = useState(room?.description ?? "");
  const [maxAdults, setMaxAdults] = useState(String(room?.maxAdults ?? 2));
  const [maxChildren, setMaxChildren] = useState(String(room?.maxChildren ?? 0));
  const [maxGuests, setMaxGuests] = useState(String(room?.maxGuests ?? 2));
  const [bedType, setBedType] = useState<BedType>(room?.beds[0]?.type ?? "double");
  const [bedCount, setBedCount] = useState(String(room?.beds[0]?.count ?? 1));
  const [amenities, setAmenities] = useState<string[]>(room?.amenities ?? ["Wi-Fi", "Air conditioning"]);
  const [photos, setPhotos] = useState<RoomPhotoDraft[]>(() =>
    (room?.photoUrls ?? []).map((url, index) => ({ id: `saved-${index}-${url}`, uri: url, uploadedUrl: url })),
  );
  const [uploadingPhoto, setUploadingPhoto] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const adults = parseInteger(maxAdults);
  const children = parseInteger(maxChildren);
  const guests = parseInteger(maxGuests);
  const beds = parseInteger(bedCount);
  const capacityValid = adults !== null && adults > 0 && children !== null && children >= 0 && guests !== null && guests >= adults && guests <= adults + children;
  const valid = name.trim().length > 0 && capacityValid && beds !== null && beds > 0 && photos.length <= 30;

  const pickPhotos = async () => {
    setError(null);
    const remaining = 30 - photos.length;
    if (remaining <= 0) {
      setError("You can add up to 30 room photos.");
      return;
    }

    if (Platform.OS !== "web") {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError("Allow photo library access in your device settings to add room photos.");
        return;
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      orderedSelection: true,
      selectionLimit: remaining,
      quality: 0.85,
      base64: true,
    });
    if (result.canceled) return;

    const accepted: RoomPhotoDraft[] = [];
    let rejected = 0;
    result.assets.slice(0, remaining).forEach((asset, index) => {
      const mimeType = imageMimeType(asset);
      if (!mimeType || !asset.base64) {
        rejected += 1;
        return;
      }
      accepted.push({
        id: `picked-${Date.now()}-${index}-${asset.assetId ?? asset.uri}`,
        uri: asset.uri,
        base64: asset.base64,
        mimeType,
      });
    });
    setPhotos((current) => [...current, ...accepted].slice(0, 30));
    if (rejected > 0) {
      setError(`${rejected} photo${rejected === 1 ? " was" : "s were"} skipped. Please choose JPEG or PNG files.`);
    }
  };

  const movePhoto = (from: number, to: number) => {
    if (to < 0 || to >= photos.length || from === to) return;
    setPhotos((current) => {
      const next = [...current];
      const [photo] = next.splice(from, 1);
      if (!photo) return current;
      next.splice(to, 0, photo);
      return next;
    });
  };

  const save = async () => {
    setSubmitted(true);
    setError(null);
    if (!valid || adults === null || children === null || guests === null || beds === null) return;
    setSaving(true);
    try {
      const uploadedPhotos: RoomPhotoDraft[] = [];
      for (let index = 0; index < photos.length; index += 1) {
        const photo = photos[index];
        if (!photo) continue;
        if (photo.uploadedUrl) {
          uploadedPhotos.push(photo);
          continue;
        }
        if (!photo.base64 || !photo.mimeType) throw new Error("One selected photo could not be prepared. Remove it and choose it again.");
        setUploadingPhoto(index + 1);
        const uploadedUrl = await apiClient.uploadImage({ base64: photo.base64, mimeType: photo.mimeType });
        uploadedPhotos.push({ id: photo.id, uri: uploadedUrl, uploadedUrl });
      }
      setPhotos(uploadedPhotos);
      const input: RoomInput = {
        name: name.trim(),
        description: description.trim() || null,
        maxAdults: adults,
        maxChildren: children,
        maxGuests: guests,
        beds: [{ type: bedType, count: beds }],
        amenities,
        photoUrls: uploadedPhotos.map((photo) => photo.uploadedUrl).filter((url): url is string => Boolean(url)),
        active: room?.active ?? true,
      };
      onSaved(room ? await apiClient.updateRoom(room.id, input) : await apiClient.createRoom(input));
    } catch (nextError) {
      setError(authErrorMessage(nextError));
    } finally {
      setUploadingPhoto(null);
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={uiStyles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <ScreenHeader title={room ? "Edit room" : "New room"} onBack={onBack} />
        <Text style={styles.lead}>Add the room details guests need to compare it with other options.</Text>
        {error ? <InlineState tone="danger">{error}</InlineState> : null}
        <View style={styles.formSection}>
          <Field label="Name" placeholder="Deluxe Room" value={name} onChangeText={setName} editable={!saving} error={submitted && !name.trim() ? "Enter a name" : undefined} />
          <Field label="Description" placeholder="Spacious room with a garden view" value={description} onChangeText={setDescription} multiline numberOfLines={4} style={styles.textArea} editable={!saving} />
        </View>
        <View style={styles.formSection}>
          <SectionTitle>Capacity</SectionTitle>
          <View style={styles.fieldRow}>
            <View style={styles.fieldHalf}><Field label="Adults" keyboardType="number-pad" value={maxAdults} onChangeText={setMaxAdults} editable={!saving} /></View>
            <View style={styles.fieldHalf}><Field label="Children" keyboardType="number-pad" value={maxChildren} onChangeText={setMaxChildren} editable={!saving} /></View>
          </View>
          <Field
            label="Total guests"
            keyboardType="number-pad"
            value={maxGuests}
            onChangeText={setMaxGuests}
            editable={!saving}
            error={submitted && !capacityValid ? "Total guests must include all adults and stay within the combined capacity" : undefined}
          />
        </View>
        <View style={styles.formSection}>
          <SectionTitle>Beds</SectionTitle>
          <ChoiceRow
            options={bedOptions}
            selected={bedType}
            onSelect={(value) => setBedType(value as BedType)}
          />
          <Field label="Number of beds" keyboardType="number-pad" value={bedCount} onChangeText={setBedCount} editable={!saving} error={submitted && (!beds || beds < 1) ? "Add at least one bed" : undefined} />
        </View>
        <View style={styles.formSection}>
          <SectionTitle>Amenities</SectionTitle>
          <Text style={styles.sectionHelper}>Select everything included with this room.</Text>
          <AmenityPicker selected={amenities} onChange={setAmenities} disabled={saving} />
        </View>
        <View style={styles.formSection}>
          <View style={styles.photoHeading}>
            <View style={{ flex: 1 }}>
              <SectionTitle>Room photos</SectionTitle>
              <Text style={styles.sectionHelper}>{photos.length}/30 · the first photo is the cover.</Text>
            </View>
            <Button variant="secondary" icon={ImagePlus} onPress={() => void pickPhotos()} disabled={saving || photos.length >= 30}>Add photos</Button>
          </View>
          {photos.length === 0 ? (
            <Pressable accessibilityRole="button" onPress={() => void pickPhotos()} disabled={saving} style={({ pressed }) => [styles.photoEmpty, pressed && styles.pressed]}>
              <View style={styles.photoEmptyIcon}><ImagePlus size={25} color={theme.colors.action} /></View>
              <Text style={styles.photoEmptyTitle}>Choose photos from this device</Text>
              <Text style={styles.photoEmptyText}>JPEG or PNG · select several at once</Text>
            </Pressable>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoStrip}>
              {photos.map((photo, index) => (
                <PhotoEditorCard
                  key={photo.id}
                  photo={photo}
                  index={index}
                  count={photos.length}
                  disabled={saving}
                  onCover={() => movePhoto(index, 0)}
                  onMoveLeft={() => movePhoto(index, index - 1)}
                  onMoveRight={() => movePhoto(index, index + 1)}
                  onRemove={() => setPhotos((current) => current.filter((item) => item.id !== photo.id))}
                />
              ))}
            </ScrollView>
          )}
        </View>
        {uploadingPhoto ? <InlineState tone="warning">Uploading photo {uploadingPhoto} of {photos.length}…</InlineState> : null}
        <Button onPress={() => void save()} loading={saving} icon={Check}>{room ? "Save changes" : "Create room"}</Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function AmenityPicker({ selected, onChange, disabled }: { selected: string[]; onChange: (next: string[]) => void; disabled: boolean }) {
  const options = [...amenityOptions, ...selected.filter((value) => !amenityOptions.includes(value))];
  return (
    <View style={styles.choices}>
      {options.map((amenity) => {
        const isSelected = selected.includes(amenity);
        return (
          <Pressable
            key={amenity}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isSelected, disabled }}
            disabled={disabled}
            onPress={() => onChange(isSelected ? selected.filter((value) => value !== amenity) : [...selected, amenity])}
            style={({ pressed }) => [styles.amenityChoice, isSelected && styles.amenityChoiceSelected, pressed && styles.pressed]}
          >
            {isSelected ? <Check size={15} color={theme.colors.onAction} /> : null}
            <Text style={[styles.choiceText, isSelected && styles.choiceTextSelected]}>{amenity}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function PhotoEditorCard({
  photo,
  index,
  count,
  disabled,
  onCover,
  onMoveLeft,
  onMoveRight,
  onRemove,
}: {
  photo: RoomPhotoDraft;
  index: number;
  count: number;
  disabled: boolean;
  onCover: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onRemove: () => void;
}) {
  return (
    <View style={styles.photoEditorCard}>
      <RoomPhoto uri={photo.uri} variant="preview" />
      {index === 0 ? (
        <View style={styles.coverBadge}><Star size={12} color={theme.colors.onAction} /><Text style={styles.coverBadgeText}>Cover</Text></View>
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel={`Make photo ${index + 1} the cover`} disabled={disabled} onPress={onCover} style={({ pressed }) => [styles.makeCover, pressed && styles.pressed]}>
          <Star size={14} color={theme.colors.action} /><Text style={styles.makeCoverText}>Set cover</Text>
        </Pressable>
      )}
      <Pressable accessibilityRole="button" accessibilityLabel={`Remove photo ${index + 1}`} disabled={disabled} onPress={onRemove} style={({ pressed }) => [styles.removePhoto, pressed && styles.pressed]}>
        <Trash2 size={16} color={theme.colors.danger} />
      </Pressable>
      <View style={styles.photoOrderRow}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Move photo ${index + 1} left`} disabled={disabled || index === 0} onPress={onMoveLeft} style={({ pressed }) => [styles.orderButton, (disabled || index === 0) && styles.orderButtonDisabled, pressed && styles.pressed]}>
          <ChevronLeft size={18} color={theme.colors.textSecondary} />
        </Pressable>
        <Text style={styles.photoPosition}>{index + 1} / {count}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`Move photo ${index + 1} right`} disabled={disabled || index === count - 1} onPress={onMoveRight} style={({ pressed }) => [styles.orderButton, (disabled || index === count - 1) && styles.orderButtonDisabled, pressed && styles.pressed]}>
          <ChevronRight size={18} color={theme.colors.textSecondary} />
        </Pressable>
      </View>
    </View>
  );
}

function RoomDetail({ room, onBack, onEdit, onAddRate, onEditRate }: { room: Room; onBack: () => void; onEdit: () => void; onAddRate: () => void; onEditRate: (rate: RatePeriod) => void }) {
  const [rates, setRates] = useState<RatePeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadRates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setRates(await apiClient.listRates(room.id)); }
    catch (nextError) { setError(authErrorMessage(nextError)); }
    finally { setLoading(false); }
  }, [room.id]);

  useEffect(() => { void loadRates(); }, [loadRates]);

  return (
    <ScrollView style={uiStyles.screen} contentContainerStyle={styles.screenContent} showsVerticalScrollIndicator={false}>
      <ScreenHeader title={room.name} onBack={onBack} action={<HeaderAction icon={Edit3} label="Edit" onPress={onEdit} />} />
      <View style={styles.detailHero}>
        <RoomPhoto uri={room.photoUrls[0]} variant="hero" />
        <Text style={styles.detailDescription}>{room.description || "No description added yet"}</Text>
        <View style={styles.detailMetaRow}>
          <View style={styles.detailMeta}><Users size={18} color={theme.colors.action} /><Text style={styles.detailMetaText}>up to {room.maxGuests} guests</Text></View>
          <View style={styles.detailMeta}><BedDouble size={18} color={theme.colors.action} /><Text style={styles.detailMetaText}>{bedSummary(room)}</Text></View>
        </View>
        {room.amenities.length ? <Text style={styles.amenities}>{room.amenities.join(" · ")}</Text> : null}
      </View>

      <View style={styles.section}>
        <SectionTitle action={<HeaderAction icon={Plus} label="Add" onPress={onAddRate} />}>Date-based rates</SectionTitle>
        <Text style={styles.sectionHelper}>One card is one date period with one nightly price. Add a new period when the price changes.</Text>
        {error ? <InlineState tone="danger">{error}</InlineState> : loading ? <LoadingState label="Loading rates…" compact /> : rates.length === 0 ? (
          <View style={styles.emptyWrap}>
            <EmptyState title="No rates yet" description="Add the price and conditions for the first period." />
            <Button onPress={onAddRate} icon={Plus}>Add rate</Button>
          </View>
        ) : (
          <View style={styles.list}>{rates.map((rate) => <RateCard key={rate.id} rate={rate} onPress={() => onEditRate(rate)} />)}</View>
        )}
      </View>

      {rates.length > 0 ? <PreviewCalculator room={room} rates={rates} /> : null}
    </ScrollView>
  );
}

function RateForm({ room, rate, onBack, onSaved }: { room: Room; rate: RatePeriod | null; onBack: () => void; onSaved: () => void }) {
  const [mealPlan, setMealPlan] = useState<MealPlan>(rate?.mealPlan ?? "room_only");
  const [start, setStart] = useState(rate?.start ?? todayIso());
  const [endInclusive, setEndInclusive] = useState(rate?.endInclusive ?? addDaysIso(todayIso(), 60));
  const [nightly, setNightly] = useState(rate ? moneyInput(rate.nightlyBaseCents) : "100");
  const [includedAdults, setIncludedAdults] = useState(String(rate?.includedAdults ?? Math.min(room.maxAdults, 2)));
  const [includedChildren, setIncludedChildren] = useState(String(rate?.includedChildren ?? 0));
  const [extraAdult, setExtraAdult] = useState(rate ? moneyInput(rate.extraAdultCents) : "0");
  const [extraChild, setExtraChild] = useState(rate ? moneyInput(rate.extraChildCents) : "0");
  const [maxChildAge, setMaxChildAge] = useState(String(rate?.maxChildAge ?? 17));
  const [minNights, setMinNights] = useState(String(rate?.minNights ?? 1));
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const datesValid = isIsoDate(start) && isIsoDate(endInclusive) && start <= endInclusive;
  const moneyValues = [nightly, extraAdult, extraChild].map(parseMoneyCents);
  const integerValues = [includedAdults, includedChildren, maxChildAge, minNights].map(parseInteger);
  const valid = datesValid && moneyValues.every((value) => value !== null && value >= 0) && integerValues.every((value) => value !== null && value >= 0) && (integerValues[3] ?? 0) > 0 && (integerValues[2] ?? 18) <= 17;

  const save = async () => {
    setSubmitted(true);
    setError(null);
    if (!valid) return;
    const [nightlyBaseCents, extraAdultCents, extraChildCents] = moneyValues as [number, number, number];
    const [adults, children, childAge, nights] = integerValues as [number, number, number, number];
    const input: RatePeriodInput = {
      planCode: rate?.planCode ?? "standard",
      planName: rate?.planName ?? "Standard rate",
      mealPlan,
      start,
      endInclusive,
      nightlyBaseCents,
      currency: "EUR",
      includedAdults: adults,
      includedChildren: children,
      extraAdultCents,
      extraChildCents,
      maxChildAge: childAge,
      minNights: nights,
      active: rate?.active ?? true,
    };
    setSaving(true);
    try {
      if (rate) await apiClient.updateRate(room.id, rate.id, input);
      else await apiClient.createRate(room.id, input);
      onSaved();
    }
    catch (nextError) { setError(authErrorMessage(nextError)); }
    finally { setSaving(false); }
  };

  return (
    <KeyboardAvoidingView style={uiStyles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <ScreenHeader title={rate ? "Edit rate" : "New rate"} onBack={onBack} />
        <Text style={styles.lead}>{room.name}</Text>
        {error ? <InlineState tone="danger">{error}</InlineState> : null}
        <View style={styles.formSection}>
          <View style={styles.rateRuleCard}>
            <View style={styles.rateRuleIcon}><CalendarDays size={20} color={theme.colors.action} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rateRuleTitle}>One period = one nightly price</Text>
              <Text style={styles.rateRuleText}>When the price changes, add the next non-overlapping period. Dates include the last selected day.</Text>
            </View>
          </View>
          <Text style={styles.fieldLabel}>Meal plan</Text>
          <ChoiceRow options={[{ value: "room_only", label: "Room only" }, { value: "breakfast", label: "Breakfast included" }]} selected={mealPlan} onSelect={(value) => setMealPlan(value as MealPlan)} />
        </View>
        <View style={styles.formSection}>
          <SectionTitle>One period, one price</SectionTitle>
          <Field label="Start date" placeholder="2026-11-01" autoCapitalize="none" value={start} onChangeText={setStart} editable={!saving} helper="YYYY-MM-DD" />
          <Field label="End date, inclusive" placeholder="2026-12-31" autoCapitalize="none" value={endInclusive} onChangeText={setEndInclusive} editable={!saving} error={submitted && !datesValid ? "Check the period dates" : undefined} />
          <Field label="Price per night, EUR" keyboardType="decimal-pad" value={nightly} onChangeText={setNightly} editable={!saving} error={submitted && parseMoneyCents(nightly) === null ? "Enter an amount, for example 100 or 100.50" : undefined} />
          {datesValid && parseMoneyCents(nightly) !== null ? (
            <View style={styles.rateSummary}>
              <Text style={styles.rateSummaryPeriod}>{formatDate(start)} — {formatDate(endInclusive)}</Text>
              <Text style={styles.rateSummaryPrice}>{formatCents(parseMoneyCents(nightly) ?? 0)} / night</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.formSection}>
          <SectionTitle>Guests and supplements</SectionTitle>
          <View style={styles.fieldRow}>
            <View style={styles.fieldHalf}><Field label="Adults included" keyboardType="number-pad" value={includedAdults} onChangeText={setIncludedAdults} editable={!saving} /></View>
            <View style={styles.fieldHalf}><Field label="Children included" keyboardType="number-pad" value={includedChildren} onChangeText={setIncludedChildren} editable={!saving} /></View>
          </View>
          <View style={styles.fieldRow}>
            <View style={styles.fieldHalf}><Field label="Extra adult, EUR" keyboardType="decimal-pad" value={extraAdult} onChangeText={setExtraAdult} editable={!saving} /></View>
            <View style={styles.fieldHalf}><Field label="Extra child, EUR" keyboardType="decimal-pad" value={extraChild} onChangeText={setExtraChild} editable={!saving} /></View>
          </View>
          <View style={styles.fieldRow}>
            <View style={styles.fieldHalf}><Field label="Child age up to" keyboardType="number-pad" value={maxChildAge} onChangeText={setMaxChildAge} editable={!saving} /></View>
            <View style={styles.fieldHalf}><Field label="Minimum nights" keyboardType="number-pad" value={minNights} onChangeText={setMinNights} editable={!saving} /></View>
          </View>
          {submitted && !valid ? <Text style={styles.validationSummary}>Check the numbers: values cannot be negative, child age is up to 17, and minimum stay starts at 1 night.</Text> : null}
        </View>
        <Button onPress={() => void save()} loading={saving} icon={Check}>{rate ? "Save rate changes" : "Add rate period"}</Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function PreviewCalculator({ room, rates }: { room: Room; rates: RatePeriod[] }) {
  const planCodes = useMemo(() => [...new Set(rates.map((rate) => rate.planCode))], [rates]);
  const [planCode, setPlanCode] = useState(planCodes[0] ?? "standard");
  const [checkIn, setCheckIn] = useState(rates[0]?.start ?? "2026-11-01");
  const [checkOut, setCheckOut] = useState(rates[0]?.endExclusive ?? "2026-11-02");
  const [adults, setAdults] = useState("2");
  const [childAges, setChildAges] = useState("");
  const [preview, setPreview] = useState<RatePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const calculate = async () => {
    setError(null);
    setPreview(null);
    const adultCount = parseInteger(adults);
    const ages = childAges.split(",").map((value) => value.trim()).filter(Boolean).map(Number);
    if (!isIsoDate(checkIn) || !isIsoDate(checkOut) || checkIn >= checkOut || !adultCount || ages.some((age) => !Number.isInteger(age) || age < 0 || age > 17)) {
      setError("Check the dates, adult count and child ages.");
      return;
    }
    setLoading(true);
    try { setPreview(await apiClient.previewRate(room.id, { planCode, checkIn, checkOut, adults: adultCount, childAges: ages })); }
    catch (nextError) { setError(authErrorMessage(nextError)); }
    finally { setLoading(false); }
  };

  return (
    <View style={styles.section}>
      <SectionTitle>Price check</SectionTitle>
      <View style={[uiStyles.card, styles.previewCard]}>
        <Text style={styles.previewIntro}>See how the system prices a sample request.</Text>
        <ChoiceRow options={planCodes.map((value) => ({ value, label: value }))} selected={planCode} onSelect={setPlanCode} />
        <View style={styles.fieldRow}>
          <View style={styles.fieldHalf}><Field label="Check-in" value={checkIn} onChangeText={setCheckIn} autoCapitalize="none" /></View>
          <View style={styles.fieldHalf}><Field label="Check-out" value={checkOut} onChangeText={setCheckOut} autoCapitalize="none" /></View>
        </View>
        <View style={styles.fieldRow}>
          <View style={styles.fieldHalf}><Field label="Adults" keyboardType="number-pad" value={adults} onChangeText={setAdults} /></View>
          <View style={styles.fieldHalf}><Field label="Child ages" keyboardType="numbers-and-punctuation" placeholder="5, 10" value={childAges} onChangeText={setChildAges} /></View>
        </View>
        {error ? <InlineState tone="danger">{error}</InlineState> : null}
        {preview?.ok ? (
          <View style={styles.previewResult}>
            <View><Text style={styles.previewResultLabel}>{preview.price.nights.length} night{preview.price.nights.length === 1 ? "" : "s"}</Text><Text style={styles.previewResultHint}>Server calculation</Text></View>
            <Text style={styles.previewTotal}>{formatCents(preview.price.totalCents)}</Text>
          </View>
        ) : preview && !preview.ok ? (
          <InlineState tone="warning">No complete rate coverage: {preview.issues.map((issue) => issue.date ?? issue.type).join(", ")}</InlineState>
        ) : null}
        <Button variant="secondary" onPress={() => void calculate()} loading={loading}>Calculate</Button>
      </View>
    </View>
  );
}

function RateCard({ rate, onPress }: { rate: RatePeriod; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Edit rate from ${rate.start} to ${rate.endInclusive}`} onPress={onPress} style={({ pressed }) => [uiStyles.card, styles.rateCard, pressed && styles.pressed]}>
      <View style={styles.rateTop}>
        <View style={styles.rateIcon}>{rate.mealPlan === "breakfast" ? <Coffee size={20} color={theme.colors.action} /> : <BedDouble size={20} color={theme.colors.action} />}</View>
        <View style={{ flex: 1 }}><Text style={styles.rateName}>{formatDate(rate.start)} — {formatDate(rate.endInclusive)}</Text><Text style={styles.rateCode}>One price for this period</Text></View>
        <Text style={styles.ratePrice}>{formatCents(rate.nightlyBaseCents)}</Text>
        <Edit3 size={17} color={theme.colors.action} />
      </View>
      <Text style={styles.rateConditions}>{rate.mealPlan === "breakfast" ? "Breakfast included" : "Room only"} · {rate.includedAdults} adult{rate.includedAdults === 1 ? "" : "s"} · min. {rate.minNights} night{rate.minNights === 1 ? "" : "s"}</Text>
    </Pressable>
  );
}

function RoomPhoto({ uri, variant }: { uri?: string | undefined; variant: "card" | "hero" | "preview" }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [uri]);
  const imageStyle = variant === "card" ? styles.roomImage : variant === "hero" ? styles.roomHeroImage : styles.roomPreviewImage;
  if (!uri || failed) {
    return <View style={[imageStyle, styles.roomImageFallback]}><ImageIcon size={variant === "hero" ? 30 : 23} color={theme.colors.action} /></View>;
  }
  return <Image source={{ uri }} resizeMode="cover" accessibilityLabel="Room photo" onError={() => setFailed(true)} style={imageStyle} />;
}

function ScreenHeader({ title, onBack, action }: { title: string; onBack: () => void; action?: ReactNode }) {
  return (
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={({ pressed }) => [styles.back, pressed && styles.pressed]}><ArrowLeft size={22} color={theme.colors.text} /></Pressable>
      <Text numberOfLines={1} style={styles.headerTitle}>{title}</Text>
      <View style={styles.headerAction}>{action}</View>
    </View>
  );
}

function HeaderAction({ icon: Icon, label, onPress }: { icon: typeof Plus; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.headerActionButton, pressed && styles.pressed]}>
      <Icon size={17} color={theme.colors.action} /><Text style={styles.headerActionLabel}>{label}</Text>
    </Pressable>
  );
}

function ChoiceRow({ options, selected, onSelect }: { options: Array<{ value: string; label: string }>; selected: string; onSelect: (value: string) => void }) {
  return (
    <View style={styles.choices}>{options.map((option) => (
      <Pressable key={option.value} accessibilityRole="button" accessibilityState={{ selected: option.value === selected }} onPress={() => onSelect(option.value)} style={({ pressed }) => [styles.choice, option.value === selected && styles.choiceSelected, pressed && styles.pressed]}>
        <Text style={[styles.choiceText, option.value === selected && styles.choiceTextSelected]}>{option.label}</Text>
      </Pressable>
    ))}</View>
  );
}

function LoadingState({ label, compact = false }: { label: string; compact?: boolean }) {
  return <View style={[styles.loading, compact && styles.loadingCompact]}><ActivityIndicator color={theme.colors.action} /><Text style={styles.loadingText}>{label}</Text></View>;
}

const bedOptions = [
  { value: "single", label: "Single" }, { value: "double", label: "Double" },
  { value: "queen", label: "Queen" }, { value: "king", label: "King" },
  { value: "sofa_bed", label: "Sofa bed" }, { value: "bunk", label: "Bunk bed" }, { value: "crib", label: "Cot" },
];

const amenityOptions = [
  "Wi-Fi",
  "Air conditioning",
  "Private bathroom",
  "Breakfast",
  "Balcony",
  "Sea view",
  "City view",
  "Kitchen",
  "Minibar",
  "TV",
  "Safe",
  "Workspace",
  "Soundproofing",
  "Accessible",
  "Parking",
];

function parseInteger(value: string): number | null { const parsed = Number(value); return Number.isInteger(parsed) ? parsed : null; }
function parseMoneyCents(value: string): number | null { const parsed = Number(value.replace(",", ".")); return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : null; }
function isIsoDate(value: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)); }
function imageMimeType(asset: ImagePicker.ImagePickerAsset): "image/jpeg" | "image/png" | null {
  const declared = asset.mimeType?.toLowerCase();
  if (declared === "image/jpeg" || declared === "image/jpg") return "image/jpeg";
  if (declared === "image/png") return "image/png";
  const fileName = (asset.fileName ?? asset.uri).toLowerCase().split("?")[0] ?? "";
  if (fileName.endsWith(".jpg") || fileName.endsWith(".jpeg")) return "image/jpeg";
  if (fileName.endsWith(".png")) return "image/png";
  return null;
}
function todayIso(): string { return new Date().toISOString().slice(0, 10); }
function addDaysIso(date: string, days: number): string { const next = new Date(`${date}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + days); return next.toISOString().slice(0, 10); }
function moneyInput(cents: number): string { return (cents / 100).toFixed(2).replace(/\.00$/, ""); }
function formatCents(cents: number): string { return new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(cents / 100); }
function formatDate(date: string): string { const [year, month, day] = date.split("-"); return `${day}.${month}.${year}`; }
function bedSummary(room: Room): string { return room.beds.length ? room.beds.map((bed) => `${bed.count} ${bed.type.replace("_", " ")}`).join(", ") : "beds not specified"; }

const styles = StyleSheet.create({
  screenContent: { paddingHorizontal: theme.controls.contentInset, paddingBottom: theme.spacing[10], gap: theme.spacing[4] },
  header: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  back: { width: 44, height: 44, borderRadius: theme.radii.md, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  headerTitle: { ...theme.typography.h3, color: theme.colors.text, flex: 1 },
  headerAction: { minWidth: 44, alignItems: "flex-end" },
  headerActionButton: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: theme.spacing[1], paddingHorizontal: theme.spacing[2] },
  headerActionLabel: { ...theme.typography.captionMedium, color: theme.colors.action },
  lead: { ...theme.typography.bodySmall, color: theme.colors.textSecondary, marginBottom: theme.spacing[2] },
  pressed: { opacity: 0.65 },
  stateGap: { gap: theme.spacing[3] },
  loading: { minHeight: 320, alignItems: "center", justifyContent: "center", gap: theme.spacing[3] },
  loadingCompact: { minHeight: 140 },
  loadingText: { ...theme.typography.bodySmall, color: theme.colors.textSecondary },
  summaryCard: { minHeight: 96, flexDirection: "row", alignItems: "center", gap: theme.spacing[3], backgroundColor: theme.colors.actionTint, borderRadius: theme.radii.lg, paddingHorizontal: theme.spacing[4] },
  summaryIcon: { width: 44, height: 44, borderRadius: theme.radii.md, backgroundColor: theme.colors.surface, alignItems: "center", justifyContent: "center" },
  summaryValue: { ...theme.typography.h2, color: theme.colors.action },
  summaryLabel: { ...theme.typography.caption, color: theme.colors.textSecondary },
  section: { gap: theme.spacing[3], marginTop: theme.spacing[3] },
  list: { gap: theme.spacing[3] },
  emptyWrap: { gap: theme.spacing[3] },
  roomCard: { flexDirection: "row", alignItems: "center", gap: theme.spacing[3] },
  roomImage: { width: 72, height: 72, borderRadius: theme.radii.md, backgroundColor: theme.colors.actionTint },
  roomHeroImage: { width: "100%", height: 190, borderRadius: theme.radii.lg, backgroundColor: theme.colors.actionTint },
  roomPreviewImage: { width: 120, height: 88, borderRadius: theme.radii.md, backgroundColor: theme.colors.actionTint },
  roomImageFallback: { alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.colors.border },
  roomName: { ...theme.typography.h4, color: theme.colors.text },
  roomDescription: { ...theme.typography.caption, color: theme.colors.textMuted, marginTop: 2 },
  compactMeta: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1], marginTop: theme.spacing[2] },
  compactMetaText: { ...theme.typography.captionMedium, color: theme.colors.textSecondary },
  formSection: { gap: theme.spacing[4], marginBottom: theme.spacing[3] },
  textArea: { minHeight: 108, paddingTop: theme.spacing[3], textAlignVertical: "top" },
  sectionHelper: { ...theme.typography.caption, color: theme.colors.textMuted, marginTop: -theme.spacing[3] },
  photoHeading: { flexDirection: "row", alignItems: "center", gap: theme.spacing[3] },
  photoStrip: { gap: theme.spacing[3], paddingRight: theme.spacing[2] },
  photoEmpty: { minHeight: 156, alignItems: "center", justifyContent: "center", gap: theme.spacing[2], backgroundColor: theme.colors.actionTint, borderWidth: 1, borderStyle: "dashed", borderColor: theme.colors.action, borderRadius: theme.radii.lg, padding: theme.spacing[4] },
  photoEmptyIcon: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: theme.radii.pill, backgroundColor: theme.colors.surface },
  photoEmptyTitle: { ...theme.typography.bodySmallMedium, color: theme.colors.text },
  photoEmptyText: { ...theme.typography.caption, color: theme.colors.textMuted },
  photoEditorCard: { width: 120, gap: theme.spacing[2] },
  coverBadge: { position: "absolute", top: theme.spacing[2], left: theme.spacing[2], minHeight: 28, flexDirection: "row", alignItems: "center", gap: 4, borderRadius: theme.radii.pill, backgroundColor: theme.colors.action, paddingHorizontal: theme.spacing[2] },
  coverBadgeText: { ...theme.typography.captionMedium, color: theme.colors.onAction },
  makeCover: { position: "absolute", top: theme.spacing[2], left: theme.spacing[2], minHeight: 28, flexDirection: "row", alignItems: "center", gap: 4, borderRadius: theme.radii.pill, backgroundColor: theme.colors.surface, paddingHorizontal: theme.spacing[2] },
  makeCoverText: { ...theme.typography.captionMedium, color: theme.colors.action },
  removePhoto: { position: "absolute", top: theme.spacing[2], right: theme.spacing[2], width: 30, height: 30, borderRadius: theme.radii.pill, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.surface },
  photoOrderRow: { minHeight: 36, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  orderButton: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: theme.radii.md, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  orderButtonDisabled: { opacity: 0.3 },
  photoPosition: { ...theme.typography.captionMedium, color: theme.colors.textSecondary },
  fieldRow: { flexDirection: "row", gap: theme.spacing[3] },
  fieldHalf: { flex: 1 },
  fieldLabel: { ...theme.typography.bodySmallMedium, color: theme.colors.text },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
  choice: { minHeight: 40, justifyContent: "center", borderRadius: theme.radii.pill, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, paddingHorizontal: theme.spacing[3] },
  choiceSelected: { backgroundColor: theme.colors.action, borderColor: theme.colors.action },
  amenityChoice: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: theme.spacing[1], borderRadius: theme.radii.pill, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, paddingHorizontal: theme.spacing[3] },
  amenityChoiceSelected: { backgroundColor: theme.colors.action, borderColor: theme.colors.action },
  choiceText: { ...theme.typography.bodySmallMedium, color: theme.colors.textSecondary },
  choiceTextSelected: { color: theme.colors.onAction },
  validationSummary: { ...theme.typography.captionMedium, color: theme.colors.danger },
  detailHero: { borderRadius: theme.radii.lg, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing[4], gap: theme.spacing[3] },
  detailDescription: { ...theme.typography.body, color: theme.colors.textSecondary },
  detailMetaRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
  detailMeta: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2], backgroundColor: theme.colors.actionTint, borderRadius: theme.radii.pill, paddingHorizontal: theme.spacing[3], minHeight: 36 },
  detailMetaText: { ...theme.typography.captionMedium, color: theme.colors.action },
  amenities: { ...theme.typography.caption, color: theme.colors.textMuted },
  rateCard: { gap: theme.spacing[3] },
  rateTop: { flexDirection: "row", alignItems: "center", gap: theme.spacing[3] },
  rateIcon: { width: 40, height: 40, borderRadius: theme.radii.md, backgroundColor: theme.colors.actionTint, alignItems: "center", justifyContent: "center" },
  rateName: { ...theme.typography.bodySmallMedium, color: theme.colors.text },
  rateCode: { ...theme.typography.caption, color: theme.colors.textMuted },
  ratePrice: { ...theme.typography.h4, color: theme.colors.text },
  rateConditions: { ...theme.typography.caption, color: theme.colors.textMuted },
  rateRuleCard: { flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[3], backgroundColor: theme.colors.actionTint, borderRadius: theme.radii.lg, padding: theme.spacing[4] },
  rateRuleIcon: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: theme.radii.md, backgroundColor: theme.colors.surface },
  rateRuleTitle: { ...theme.typography.bodySmallMedium, color: theme.colors.text },
  rateRuleText: { ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: 3 },
  rateSummary: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: theme.spacing[2], backgroundColor: theme.colors.successTint, borderRadius: theme.radii.md, padding: theme.spacing[3] },
  rateSummaryPeriod: { ...theme.typography.captionMedium, color: theme.colors.success },
  rateSummaryPrice: { ...theme.typography.bodySmallMedium, color: theme.colors.success },
  previewCard: { gap: theme.spacing[4] },
  previewIntro: { ...theme.typography.bodySmall, color: theme.colors.textSecondary },
  previewResult: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: theme.colors.successTint, borderRadius: theme.radii.md, padding: theme.spacing[3] },
  previewResultLabel: { ...theme.typography.bodySmallMedium, color: theme.colors.success },
  previewResultHint: { ...theme.typography.caption, color: theme.colors.textMuted },
  previewTotal: { ...theme.typography.h3, color: theme.colors.success },
});
