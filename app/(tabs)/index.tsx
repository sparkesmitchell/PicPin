import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { Image, Modal, PanResponder, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import ViewShot from 'react-native-view-shot';

const COLORS = {
  bg: '#0f0f0f',
  surface: '#1c1c1e',
  surface2: '#2c2c2e',
  accent: '#0a84ff',
  danger: '#ff453a',
  success: '#32d74b',
  text: '#ffffff',
  textSecondary: '#ebebf599',
  border: '#38383a',
};

// Draggable pin as its own component so PanResponder is stable per pin instance
function DraggablePin({ pin, onTap, onDragEnd, isDragging }) {
  const pressStartTime = useRef(0);
  const didDrag = useRef(false);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 5 || Math.abs(gs.dy) > 5,
    onPanResponderGrant: () => {
      pressStartTime.current = Date.now();
      didDrag.current = false;
    },
    onPanResponderMove: (_, gs) => {
      didDrag.current = true;
      onDragEnd(pin.id, pin.x + gs.dx, pin.y + gs.dy, true);
    },
    onPanResponderRelease: (_, gs) => {
      const elapsed = Date.now() - pressStartTime.current;
      if (!didDrag.current && elapsed < 300) {
        onTap(pin);
      } else {
        onDragEnd(pin.id, pin.x + gs.dx, pin.y + gs.dy, false);
      }
    },
  }), [pin.id, pin.x, pin.y]);

  return (
    <View
      style={[
        styles.pin,
        { left: pin.x - 15, top: pin.y - 15 },
        isDragging && styles.pinDragging,
      ]}
      {...panResponder.panHandlers}
    >
      <View style={styles.pinDot} />
      {pin.note ? (
        <View style={styles.notePreview}>
          <Text style={styles.notePreviewText} numberOfLines={1}>{pin.note}</Text>
        </View>
      ) : null}
    </View>
  );
}

export default function App() {
  const [permission, requestPermission] = useCameraPermissions();
  const [photo, setPhoto] = useState(null);
  const [pins, setPins] = useState([]);
  const [selectedPin, setSelectedPin] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [draggingPinId, setDraggingPinId] = useState(null);
  const [savedPhotos, setSavedPhotos] = useState([]);
  const [showGallery, setShowGallery] = useState(false);
  const [showTitleModal, setShowTitleModal] = useState(false);
  const [titleText, setTitleText] = useState('');
  const [editingPhotoId, setEditingPhotoId] = useState(null);
  const [containerLayout, setContainerLayout] = useState(null);
  const [imageSize, setImageSize] = useState(null);
  const [photoOrientation, setPhotoOrientation] = useState(null);
  const photoOrientationRef = useRef(null);
  const cameraRef = useRef(null);
  const viewShotRef = useRef(null);

  useEffect(() => { loadSavedPhotos(); }, []);

  function applyOrientationLock(options: { gallery?: boolean; orientation?: any; clear?: boolean }) {
    if (options.gallery) {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    } else if (options.clear) {
      ScreenOrientation.unlockAsync();
    } else if (options.orientation) {
      ScreenOrientation.lockAsync(options.orientation);
    }
  }

  async function loadSavedPhotos() {
    try {
      const data = await AsyncStorage.getItem('savedPhotos');
      if (data) setSavedPhotos(JSON.parse(data));
    } catch (e) { console.log('Error loading photos', e); }
  }

  async function saveCurrentPhoto() {
    setShowTitleModal(true);
  }

  async function confirmSave(title, currentEditingId) {
    try {
      const flatUri = await viewShotRef.current.capture();
      let updated;
      if (currentEditingId) {
        updated = savedPhotos.map(p => p.id === currentEditingId ? { ...p, title: title || 'Untitled', pins, flatUri } : p);
      } else {
        const newEntry = { id: Date.now(), uri: photo, flatUri, pins, title: title || 'Untitled' };
        updated = [newEntry, ...savedPhotos];
      }
      const jsonString = JSON.stringify(updated);
      await AsyncStorage.setItem('savedPhotos', jsonString);
      setSavedPhotos(JSON.parse(jsonString));
      setShowTitleModal(false);
      setTitleText('');
      setEditingPhotoId(null);
      alert(currentEditingId ? 'Photo updated!' : 'Photo saved!');
    } catch (e) { alert('Error: ' + e.message); }
  }

  async function deletePhoto(id) {
    const updated = savedPhotos.filter(p => p.id !== id);
    await AsyncStorage.setItem('savedPhotos', JSON.stringify(updated));
    setSavedPhotos(updated);
  }

  async function takePhoto() {
    if (cameraRef.current) {
      // Capture current orientation before taking the photo
      const currentOrientation = await ScreenOrientation.getOrientationAsync();
      const orientationLock =
        currentOrientation === ScreenOrientation.Orientation.LANDSCAPE_LEFT
          ? ScreenOrientation.OrientationLock.LANDSCAPE_LEFT
          : currentOrientation === ScreenOrientation.Orientation.LANDSCAPE_RIGHT
          ? ScreenOrientation.OrientationLock.LANDSCAPE_RIGHT
          : ScreenOrientation.OrientationLock.PORTRAIT_UP;

      const result = await cameraRef.current.takePictureAsync({
        exif: true,
        skipProcessing: false,
      });

      // Read EXIF orientation and rotate to correct it
      const exifOrientation = result.exif?.Orientation ?? 1;
      const rotationMap = { 1: 0, 3: 180, 6: 90, 8: -90 };
      const rotation = rotationMap[exifOrientation] ?? 0;
      const actions = rotation !== 0 ? [{ rotate: rotation }] : [];

      const manipulated = await ImageManipulator.manipulateAsync(
        result.uri,
        actions,
        { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
      );

      setPhoto(manipulated.uri);
      setPhotoOrientation(orientationLock);
      photoOrientationRef.current = orientationLock;
      applyOrientationLock({ orientation: orientationLock });
      setPins([]);
      setContainerLayout(null);
      setImageSize(null);
    }
  }

  async function pickFromGallery() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });
    if (!result.canceled) {
      setPhoto(result.assets[0].uri);
      setPins([]);
      setPhotoOrientation(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      photoOrientationRef.current = ScreenOrientation.OrientationLock.PORTRAIT_UP;
      applyOrientationLock({ orientation: ScreenOrientation.OrientationLock.PORTRAIT_UP });
      setContainerLayout(null);
      setImageSize(null);
    }
  }

  async function sharePhoto() {
    try {
      const uri = await viewShotRef.current.capture();
      await Sharing.shareAsync(uri);
    } catch (e) { alert('Error sharing: ' + e.message); }
  }

  async function saveGalleryPhotoToRoll(uri) {
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') { alert('Permission needed'); return; }
      await MediaLibrary.saveToLibraryAsync(uri);
      alert('Saved to camera roll!');
    } catch (e) { alert('Error: ' + e.message); }
  }

  function getImageOverlay() {
    if (!containerLayout || !imageSize) return null;
    const containerRatio = containerLayout.width / containerLayout.height;
    const imageRatio = imageSize.width / imageSize.height;
    let width, height, x, y;
    if (imageRatio > containerRatio) {
      // Landscape image in portrait container — letterboxed (black bars top/bottom)
      width = containerLayout.width;
      height = containerLayout.width / imageRatio;
      x = 0;
      y = (containerLayout.height - height) / 2;
    } else {
      // Portrait image in portrait container — pillarboxed (black bars left/right)
      height = containerLayout.height;
      width = containerLayout.height * imageRatio;
      x = (containerLayout.width - width) / 2;
      y = 0;
    }
    return { x, y, width, height };
  }

  function handleImageTap(event) {
    const { locationX, locationY } = event.nativeEvent;
    const overlay = getImageOverlay();
    const x = locationX - (overlay?.x ?? 0);
    const y = locationY - (overlay?.y ?? 0);
    const newPin = { id: Date.now(), x, y, note: '' };
    setPins(prev => [...prev, newPin]);
    ScreenOrientation.unlockAsync().then(() => {
      setSelectedPin(newPin);
      setNoteText('');
    });
  }

  function handlePinTap(pin) {
    ScreenOrientation.unlockAsync().then(() => {
      setSelectedPin(pin);
      setNoteText(pin.note);
    });
  }

  function handlePinDrag(id, newX, newY, isDragging) {
    setDraggingPinId(isDragging ? id : null);
    setPins(prev => prev.map(p => p.id === id ? { ...p, x: newX, y: newY } : p));
  }

  function saveNote() {
    setPins(prev => prev.map(p => p.id === selectedPin.id ? { ...p, note: noteText } : p));
    setSelectedPin(null);
    if (photoOrientationRef.current) {
      ScreenOrientation.lockAsync(photoOrientationRef.current);
    }
  }

  function deletePin() {
    setPins(prev => prev.filter(p => p.id !== selectedPin.id));
    setSelectedPin(null);
    if (photoOrientationRef.current) {
      ScreenOrientation.lockAsync(photoOrientationRef.current);
    }
  }

  function openSavedPhoto(entry) {
    setPhoto(entry.uri);
    setPins(entry.pins);
    setEditingPhotoId(entry.id);
    setShowGallery(false);
  }

  if (!permission) return <View style={styles.fullScreen} />;

  if (!permission.granted) {
    return (
      <View style={styles.permissionScreen}>
        <Text style={styles.message}>Camera access is needed to use PicPins</Text>
        <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
          <Text style={styles.permissionButtonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (showGallery) {
    return (
      <View style={styles.fullScreen}>
        <StatusBar barStyle="light-content" />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => { setShowGallery(false); applyOrientationLock({ clear: true }); }} style={styles.headerBack}>
            <Text style={styles.headerBackText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>My Photos</Text>
          <View style={{ width: 70 }} />
        </View>
        <ScrollView contentContainerStyle={styles.galleryGrid}>
          {savedPhotos.length === 0 && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>📷</Text>
              <Text style={styles.emptyTitle}>No photos yet</Text>
              <Text style={styles.emptySubtitle}>Take a photo and save it to see it here</Text>
            </View>
          )}
          {savedPhotos.map(entry => (
            <View key={entry.id} style={styles.galleryCard}>
              <TouchableOpacity onPress={() => openSavedPhoto(entry)}>
                <Image source={{ uri: entry.flatUri || entry.uri }} style={styles.thumbnail} />
                <View style={styles.cardInfo}>
                  <Text style={styles.cardTitle}>{entry.title || 'Untitled'}</Text>
                  <Text style={styles.cardPins}>{entry.pins.length} pin{entry.pins.length !== 1 ? 's' : ''}</Text>
                </View>
              </TouchableOpacity>
              <View style={styles.cardActions}>
                <TouchableOpacity style={styles.cardActionBtn} onPress={() => saveGalleryPhotoToRoll(entry.flatUri)}>
                  <Text style={styles.cardActionText}>💾 Save</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.cardActionBtn, styles.cardDeleteBtn]} onPress={() => deletePhoto(entry.id)}>
                  <Text style={styles.cardActionText}>🗑 Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }

  if (photo) {
    return (
      <View style={styles.fullScreen}>
        <StatusBar barStyle="light-content" />
        <View style={styles.imageContainer}>
          <TouchableOpacity
            activeOpacity={1}
            onPress={handleImageTap}
            style={styles.imageContainer}
            onLayout={e => setContainerLayout(e.nativeEvent.layout)}
          >
            <Image
              source={{ uri: photo }}
              style={styles.photoImage}
              onLoad={e => setImageSize({
                width: e.nativeEvent.source.width,
                height: e.nativeEvent.source.height,
              })}
            />
            {(() => {
              const overlay = getImageOverlay();
              if (!overlay) return null;
              return (
                <ViewShot
                  ref={viewShotRef}
                  style={[styles.imageOverlay, {
                    left: overlay.x,
                    top: overlay.y,
                    width: overlay.width,
                    height: overlay.height,
                  }]}
                >
                  <Image
                    source={{ uri: photo }}
                    style={{ width: overlay.width, height: overlay.height }}
                  />
                  <View style={[styles.imageOverlay, { left: 0, top: 0, width: overlay.width, height: overlay.height }]}>
                    <View style={styles.watermark}>
                      <Text style={styles.watermarkText}>PicPins App</Text>
                    </View>
                    <View style={styles.timestamp}>
                      <Text style={styles.timestampText}>
                        {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </Text>
                    </View>
                    {pins.map(pin => (
                      <DraggablePin
                        key={pin.id}
                        pin={pin}
                        onTap={handlePinTap}
                        onDragEnd={handlePinDrag}
                        isDragging={draggingPinId === pin.id}
                      />
                    ))}
                  </View>
                </ViewShot>
              );
            })()}
          </TouchableOpacity>
        </View>

        <View style={styles.bottomBar}>
          <TouchableOpacity style={styles.iconBtn} onPress={() => { setPhoto(null); setPhotoOrientation(null); photoOrientationRef.current = null; setEditingPhotoId(null); applyOrientationLock({ clear: true }); }}>
            <Text style={styles.iconBtnIcon}>✕</Text>
            <Text style={styles.iconBtnLabel}>Retake</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={sharePhoto}>
            <Text style={styles.iconBtnIcon}>↗</Text>
            <Text style={styles.iconBtnLabel}>Share</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.iconBtn, styles.iconBtnAccent]} onPress={saveCurrentPhoto}>
            <Text style={styles.iconBtnIcon}>💾</Text>
            <Text style={styles.iconBtnLabel}>Save</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={() => { applyOrientationLock({ gallery: true }); setShowGallery(true); }}>
            <Text style={styles.iconBtnIcon}>▦</Text>
            <Text style={styles.iconBtnLabel}>Gallery</Text>
          </TouchableOpacity>
        </View>

        <Modal visible={selectedPin !== null} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modalBox}>
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>📍 Pin Note</Text>
              <TextInput
                style={styles.textInput}
                placeholder="Add a note..."
                placeholderTextColor={COLORS.textSecondary}
                value={noteText}
                onChangeText={setNoteText}
                multiline
              />
              <TouchableOpacity style={styles.saveButton} onPress={saveNote}>
                <Text style={styles.saveText}>Save Note</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.deleteButton} onPress={deletePin}>
                <Text style={styles.deleteText}>Delete Pin</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        <Modal visible={showTitleModal} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modalBox}>
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>Name this photo</Text>
              <TextInput
                style={styles.textInput}
                placeholder="e.g. Living room inspection"
                placeholderTextColor={COLORS.textSecondary}
                value={titleText}
                onChangeText={setTitleText}
              />
              <TouchableOpacity style={styles.saveButton} onPress={() => confirmSave(titleText, editingPhotoId)}>
                <Text style={styles.saveText}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.deleteButton} onPress={() => setShowTitleModal(false)}>
                <Text style={styles.deleteText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  // Camera screen
  return (
    <View style={styles.fullScreen}>
      <StatusBar barStyle="light-content" />
      <CameraView
        style={styles.fullScreen}
        facing="back"
        ref={cameraRef}
        videoStabilizationMode="auto"
      />
      <View style={styles.cameraTopBar}>
        <Text style={styles.appName}>PicPins</Text>
      </View>
      <View style={styles.cameraBottomBar}>
        <TouchableOpacity style={styles.sideBtn} onPress={pickFromGallery}>
          <Text style={styles.sideBtnIcon}>📷</Text>
          <Text style={styles.sideBtnLabel}>Roll</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.captureButton} onPress={takePhoto}>
          <View style={styles.captureInner} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.sideBtn} onPress={() => { applyOrientationLock({ gallery: true }); setShowGallery(true); }}>
          <Text style={styles.sideBtnIcon}>▦</Text>
          <Text style={styles.sideBtnLabel}>Gallery</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Base layouts
  fullScreen: { flex: 1, backgroundColor: COLORS.bg },
  permissionScreen: { flex: 1, backgroundColor: COLORS.bg, justifyContent: 'center', alignItems: 'center' },
  imageContainer: { flex: 1 },
  photoImage: { flex: 1, width: '100%', height: '100%', resizeMode: 'contain' },
  imageOverlay: { position: 'absolute' },

  // Permission screen
  message: { textAlign: 'center', color: COLORS.text, fontSize: 16, padding: 24 },
  permissionButton: { backgroundColor: COLORS.accent, margin: 24, padding: 16, borderRadius: 12, alignItems: 'center' },
  permissionButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  // Camera screen
  cameraTopBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    paddingTop: 56, paddingBottom: 16, paddingHorizontal: 24,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
  },
  appName: { color: '#fff', fontSize: 20, fontWeight: '700', letterSpacing: 1 },
  cameraBottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    paddingBottom: 48, paddingTop: 24,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  captureButton: {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: 'rgba(255,255,255,0.25)',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)',
  },
  captureInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#fff' },
  sideBtn: { alignItems: 'center', width: 64 },
  sideBtnIcon: { fontSize: 26 },
  sideBtnLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 11, marginTop: 4 },

  // Photo view bottom bar
  bottomBar: {
    flexDirection: 'row', justifyContent: 'space-around',
    paddingVertical: 16, paddingBottom: 36,
    backgroundColor: COLORS.surface,
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  iconBtn: { alignItems: 'center', padding: 10, borderRadius: 12, minWidth: 70, backgroundColor: COLORS.surface2, borderWidth: 1, borderColor: COLORS.border },
  iconBtnAccent: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  iconBtnIcon: { fontSize: 22 },
  iconBtnLabel: { color: COLORS.text, fontSize: 11, marginTop: 4 },

  // Pins
  pin: { position: 'absolute', alignItems: 'center' },
  pinDragging: { opacity: 0.75, transform: [{ scale: 1.2 }] },
  pinDot: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#ff3b30',
    borderWidth: 2.5, borderColor: '#fff',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4, shadowRadius: 3,
  },
  notePreview: {
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3,
    maxWidth: 120, marginTop: 2,
  },
  notePreviewText: { color: '#fff', fontSize: 10 },

  // Gallery
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 56, paddingBottom: 16, paddingHorizontal: 16,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  headerBack: { width: 70 },
  headerBackText: { color: COLORS.accent, fontSize: 16 },
  headerTitle: { color: COLORS.text, fontSize: 18, fontWeight: '700' },
  galleryGrid: { padding: 16, gap: 16 },
  galleryCard: {
    backgroundColor: COLORS.surface, borderRadius: 16, overflow: 'hidden',
    borderWidth: 1, borderColor: COLORS.border,
  },
  thumbnail: { width: '100%', height: 220 },
  cardInfo: { padding: 12 },
  cardTitle: { color: COLORS.text, fontSize: 16, fontWeight: '600' },
  cardPins: { color: COLORS.textSecondary, fontSize: 13, marginTop: 2 },
  cardActions: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: COLORS.border },
  cardActionBtn: { flex: 1, padding: 12, alignItems: 'center', backgroundColor: COLORS.surface2 },
  cardDeleteBtn: { backgroundColor: '#2c1a1a', borderLeftWidth: 1, borderLeftColor: COLORS.border },
  cardActionText: { color: COLORS.text, fontSize: 13 },
  emptyState: { alignItems: 'center', paddingTop: 80 },
  emptyEmoji: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { color: COLORS.text, fontSize: 20, fontWeight: '600', marginBottom: 8 },
  emptySubtitle: { color: COLORS.textSecondary, fontSize: 14, textAlign: 'center', paddingHorizontal: 32 },

  // Modals
  modalOverlay: {
    flex: 1, justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingBottom: 300,
  },
  modalBox: {
    backgroundColor: COLORS.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40,
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: COLORS.border, alignSelf: 'center', marginBottom: 20,
  },
  modalTitle: { color: COLORS.text, fontSize: 18, fontWeight: '700', marginBottom: 16 },
  textInput: {
    backgroundColor: COLORS.surface2, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 12, padding: 14, fontSize: 16, color: COLORS.text,
    minHeight: 90, marginBottom: 16,
  },
  saveButton: {
    backgroundColor: COLORS.accent, padding: 16,
    borderRadius: 12, alignItems: 'center', marginBottom: 8,
  },
  saveText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  deleteButton: { padding: 14, borderRadius: 12, alignItems: 'center' },
  deleteText: { color: COLORS.danger, fontSize: 16 },

  // Watermark & timestamp
  timestamp: {
    position: 'absolute', bottom: 12, right: 12,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 6,
  },
  timestampText: { color: '#fff', fontSize: 11, fontFamily: 'monospace' },
  watermark: {
    position: 'absolute', top: 12, right: 12,
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 6,
  },
  watermarkText: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '700', letterSpacing: 1 },
});
