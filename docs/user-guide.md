# Kadar user guide

Kadar is an image and video viewer for the Mac. It is fast, also with folders of many thousands of photos.

Kadar has four tabs at the top of the window:

| Tab | What it does |
|---|---|
| **Viewer** | Shows the images and videos in a folder. You can look at them, sort them, copy them, rename them and export them for the web. |
| **Optimize** | Makes small, web-ready copies of images and videos. |
| **Record** | Records the window of one app, or the entire screen, to an MP4 video. It can record the system sound and a microphone. |
| **Screenshot** | Takes a picture of the window of one app. |

In this guide, these words always have the same meaning:

- **Grid**: the thumbnails of the open folder in the Viewer tab.
- **Tile**: one thumbnail in the grid. A tile shows a file or a subfolder.
- **Big view**: one image or video, large, over the grid.
- **Selected files**: the tiles with a highlight. Most commands act on all selected files.
- **"optimized" folder**: a folder with the name "optimized". Kadar makes it next to the original files and puts the web copies in it.

---

## Get started

### Install Kadar

1. Open the Kadar disk image (the `.dmg` file).
2. Drag **Kadar** into the **Applications** folder.
3. Open Kadar from the Applications folder.

Kadar needs an Apple silicon Mac with macOS 15 or later.

### First launch

The Viewer tab opens first. The grid is empty and shows "Select a folder from the sidebar".

To show a folder, do one of these steps:

- Click a folder in the sidebar on the left.
- Click **Open Folder…** in the toolbar, then select a folder.
- Choose **File › Open Folder…** in the menu bar.

### Permissions that macOS asks for

macOS asks you to allow some actions. Kadar asks only when you use the feature that needs it.

| Permission | When macOS asks | Why Kadar needs it |
|---|---|---|
| **Screen Recording** | When you open the Record tab or the Screenshot tab for the first time. | Kadar cannot see other windows without it. Recordings and screenshots stay empty. |
| **Microphone** | When you start a recording with a microphone selected. | Kadar records your voice. |
| **Control of "System Events"** (Automation) and **Accessibility** | When you click **Resize** in the Record tab or the Screenshot tab. | Kadar moves and resizes the window of the other app. |

To change a permission later, open **System Settings › Privacy & Security**. Then select **Screen Recording**, **Microphone**, **Automation** or **Accessibility**.

After you allow Screen Recording, quit Kadar and open it again.

---

## Viewer tab

### The parts of the Viewer

- **Sidebar** (left): your favorite folders, and the folders of your Mac.
- **Toolbar** (top): Open Folder button, folder path, count, filter field, sort menu, sort direction button, thumbnail size slider.
- **Grid** (center): one tile for each subfolder, image and video.

### Sidebar

**Favorites**

- Click a favorite to open that folder.
- Click **+** to add the open folder to Favorites. If no folder is open, Kadar asks you to select a folder.
- Click **×** next to a favorite to remove it. The folder itself stays on your Mac.
- Double-click a favorite to change its name in the sidebar. Press **Return** to keep the new name or **Esc** to cancel. The folder on your Mac keeps its name.

**Locations**

Locations shows Home, Pictures, Desktop, Downloads and Movies.

- Click a folder name to open that folder in the grid.
- Click the small arrow **▸** to show or hide the subfolders.
- The folder that is open in the grid has a highlight.

### Toolbar

**Folder path**

The path shows each folder from the top of the disk to the open folder. Click a folder name in the path to open that folder.

**Count**

The count shows the number of subfolders and files. Examples:

- "2 folders, 140 items"
- "12 of 140 items" when the filter hides some files.
- "· 5 selected" when you select more than one file.
- "(truncated)" when the folder has more than 50,000 items. Kadar shows only the first 50,000.

**Filter**

Type words in the **Filter** field. The grid then shows only the files and subfolders whose names contain all the words.

- The words can be in any order.
- Upper case and lower case are the same.
- Letters with accents match letters without accents. For example, "suma" finds "Šuma".
- Press **Esc** to clear the filter.
- Press **Return** or **↓** to go back to the grid.
- When you open a different folder, Kadar clears the filter.

**Sort**

Select the sort order in the sort menu:

| Sort by | Order |
|---|---|
| Name | A to Z first. "img2" comes before "img10". |
| Date Taken | Newest first. Kadar reads the date from the camera data. A file without a camera date uses its creation date. |
| Date Modified | Newest first. |
| Date Created | Newest first. |
| Size | Largest first. |
| Kind | By file extension, A to Z first. |

- Click the arrow button (**↑** or **↓**) to reverse the order.
- When two files are equal, Kadar sorts them by name.
- Subfolders always come first, sorted by name.
- The same sort order applies to all folders.
- With Date Taken, the count shows "Reading camera dates…" for a short time. Kadar keeps these dates, so the next time is faster.

You can also use **View › Sort By** in the menu bar.

**Thumbnail size**

- Drag the slider to make the tiles larger or smaller.
- Pinch on the trackpad in the grid.
- Hold **⌘** and scroll in the grid.
- Press **⌘=** for larger tiles and **⌘-** for smaller tiles.

### Grid

Each tile shows a thumbnail and the file name. A small label shows the file type, for example "JPG", or "VIDEO" for a video. Subfolder tiles have no label.

The grid changes when the folder changes on disk. New files appear and deleted files go away. You do not have to open the folder again.

**Select files**

| Action | Result |
|---|---|
| Click a tile | Selects only that file. |
| **⌘**-click a tile | Adds the file to the selection, or removes it. |
| **⇧**-click a tile | Selects all files from the first selected file to this file. |
| **⌘A** | Selects all files and subfolders. |
| Arrow keys | Move the selection. With no selection, the first arrow key selects the top-left tile. |
| **⇧** + arrow keys | Make the selection larger or smaller. |
| **Esc** | Keeps only the last file you selected. |

**Open files**

| Action | Result |
|---|---|
| Double-click a file tile | Opens the file in the big view. |
| Double-click a subfolder tile | Opens that subfolder in the grid. |
| **Space** | Opens the selected file in the big view, or opens the selected subfolder. |
| **⌘O** or **⌘↓** | Opens the selected files in their default apps. On a subfolder, opens that subfolder in Kadar. |
| **⌘I** | Opens the selected file in the big view, with the Info panel. |

**Go to other folders**

| Key | Result |
|---|---|
| **⌘↑** | Opens the folder that contains the open folder. The folder you came from is selected. |
| **⌘[** | Goes back to the previous folder, as in Finder. |
| **⌘]** | Goes forward again. |

**Rename a file**

1. Select one file.
2. Press **Return**. You can also choose **File › Rename**, or right-click the tile and choose **Rename**.
3. Type the new name. Kadar selects the name without the extension first.
4. Press **Return** to save. A click outside the name also saves it.
5. Press **Esc** to cancel.

You can rename only one file at a time. Kadar shows an error if a file with the new name exists in the folder. A name with a slash (/) is not allowed.

**Move files to the Trash**

1. Select the files.
2. Press **⌘⌫** (Command-Delete).
3. A message shows "Moved … to the Trash" and an **Undo** button for 5 seconds.

To get the files back, click **Undo** or press **⌘Z**. If a file with the same name is in the folder again, that one file stays in the Trash.

**Undo**

Press **⌘Z** in the grid or in the big view to undo the last Move to Trash or the last rename. Press **⌘Z** again to undo the step before it. Kadar keeps the last 50 steps. When you quit Kadar, it forgets them. If there is nothing to undo, a message shows "Nothing to undo".

**Copy files**

| Key | What goes to the clipboard |
|---|---|
| **⌘C** | The selected files. You can paste them in Finder, mail and chat apps. For one image, Kadar also copies the picture. You can paste it into a document or a web page. |
| **⇧⌘C** | The full paths of the selected files, one path on each line. |

A short message shows what Kadar copied.

**Drag files to other apps**

Press on a tile and move the pointer. Kadar drags all selected files. Drop them in Finder, a browser, a mail or a chat.

Kadar always drags a copy. The original files stay in their folder.

**Show in Finder**

Press **⌘R** to show the selected file in a Finder window.

**Right-click menu**

Right-click a tile to open a menu. If the tile is not selected, Kadar selects it first. The menu acts on all selected files.

| Menu item | Key | What it does |
|---|---|---|
| Open | | Opens the file in the big view, or opens the subfolder. |
| Open in Default App | ⌘O | Opens the files in their default apps. |
| Show in Finder | ⌘R | Shows the file in Finder. |
| Rename | | Renames the file. Not available when you select more than one file. |
| Copy | ⌘C | Copies the files. |
| Copy Path | ⇧⌘C | Copies the full paths. |
| Export for Web… | ⌘E | Opens Export for Web. Not available when no image is selected. |
| Optimize | ⇧⌘O | Makes web copies in the "optimized" folder. |
| Move to Trash | ⌘⌫ | Moves the files to the Trash. |

**Optimize from the Viewer**

1. Select files or subfolders.
2. Press **⇧⌘O**, or choose **File › Optimize**.
3. Kadar uses the settings of the Optimize tab. The files also show in the list of the Optimize tab.
4. A message shows "Optimized … → "optimized" folder". Click **Show in Finder** in the message to open that folder.

### Big view

The big view shows one image or video, large. Open it with a double-click, **Space** or **⌘I**.

The line at the bottom shows:

- the file name,
- the position, for example "12 / 140" (subfolders do not count),
- the image size in pixels,
- the file size,
- the zoom. "Fit" means that the full image is visible.

**Move between files**

- Press **→** for the next file and **←** for the previous file.
- On the trackpad, swipe left or right with two fingers. This works when the image is not zoomed in. One swipe moves one file.
- Subfolders are skipped.

**Zoom and move the image**

| Action | Result |
|---|---|
| Pinch on the trackpad | Zooms in or out at the pointer. |
| **⌘** + scroll | Zooms in or out at the pointer. |
| Double-click the image | Zooms to 100% at the pointer. A small image that already shows at 100% or more zooms to two times its size. Double-click again to fit the image. |
| **1** | Zooms to 100%. One image pixel is one screen pixel. |
| **0** | Fits the full image in the window. |
| **+** or **=** | Zooms in. |
| **-** | Zooms out. |
| Drag the image | Moves a zoomed image. |
| Scroll | Moves a zoomed image. |

You cannot zoom out more than "Fit". The largest zoom is 16 times the image size.

**Video**

- A video starts to play when it opens.
- Use the video controls to play, pause, go to a time or change the volume.
- Press **Space** to play or pause.

**Info panel**

Press **I**, press **⌘I**, or click **Info** to show or hide the Info panel. Kadar remembers if the panel is open.

The Info panel shows:

| Section | What it shows |
|---|---|
| File | Name, kind, size, pixels and megapixels, length of a video, date taken, date modified, folder. |
| Camera | Camera, lens, aperture, shutter speed, ISO, focal length, exposure compensation, flash, software. |
| Place | GPS position and altitude. Click **Open in Maps** to show the place in Apple Maps. |
| Color | Color profile, color model, bit depth, transparency. |

Kadar shows only the lines that the file has data for.

**Other actions in the big view**

| Action | Result |
|---|---|
| **⌘C** | Copies the shown file. |
| **⇧⌘C** | Copies the path of the shown file. |
| **⌘E** or **Export for Web…** button | Opens Export for Web for the shown image. |
| **Esc**, **Space**, **Return** | Closes the big view. (For a video, Space plays and pauses.) |
| Click the **×** button | Closes the big view. |
| Click the dark area around the image | Closes the big view. |

When the big view closes, the grid shows the last file you looked at.

### Export for Web

Export for Web makes a small copy of an image for a web page, a mail or a chat. You see the exact result and its file size before you save it.

To open it, select one or more images and press **⌘E**. You can also use **File › Export for Web…**, the right-click menu, or the button in the big view. Export for Web uses only images. It ignores selected videos and subfolders.

**One image**

The image is on the left. The settings are on the right.

| Setting | What it does |
|---|---|
| **Rotate Left**, **Rotate Right** | Turns the image 90 degrees. Press **R** to rotate right. |
| **Crop** | The shape of the crop frame: Free, Original, Square 1:1, Portrait 4:5, 4:3, 3:2, Wide 16:9, Story 9:16. |
| **Reset** | Makes the crop frame as large as possible again. |
| **Width** | Original size, or 3840, 2560, 1920, 1600, 1200, 1080, 800, 640 or 400 pixels wide. Kadar never makes an image larger. |
| **Format** | WebP, JPG or PNG (lossless). |
| **Quality** | 30 to 100. Not shown for PNG. |

To crop:

1. Drag inside the crop frame to move it.
2. Drag an edge or a corner of the frame to change its size.
3. With a fixed shape, the frame keeps that shape.

Under the settings, Kadar shows the result: pixel size, file size and how much smaller it is than the original.

Select what the left side shows:

| Button | What you see |
|---|---|
| **Crop** | The image with the crop frame. |
| **Result** | The compressed result itself. |
| **Compare** | The original on the left and the result on the right. Drag on the image to move the line between them. |

In Compare, select **Actual pixels (1:1)** to see one image pixel on each screen pixel. Compression marks are easy to see at this size. Scroll to see other parts of the image.

When the result is good:

- Click **Copy** or press **⌘C** to copy the result. Paste it in a mail, chat or web page.
- Click **Save** or press **⌘S** to save the result in the "optimized" folder next to the original. Kadar never writes over a file. If the name exists, Kadar adds "-2", "-3" and so on.
- Click **Show in Finder** in the message to see the saved file.

Click **Close** or press **Esc** to close Export for Web.

**Many images**

When you select more than one image, Export for Web shows a sheet of all results. Each result shows its pixel size and file size.

- Rotate and the crop frame are not available.
- In the Crop menu, "Whole image" keeps each full image. A fixed shape cuts that shape from the center of each image.
- Width, Format and Quality apply to all images.
- The line under the settings shows the progress, the total size and the number of files that failed.
- **Copy** (**⌘C**) copies all result files.
- **Save** (**⌘S**) saves all results. Each result goes into the "optimized" folder next to its original.

**File names**

Kadar makes the result name from the original name: lower case, dashes for spaces, no accents. For example, "My Photo.HEIC" becomes "my-photo.webp".

Kadar remembers the crop shape, width, format and quality for the next export. It does not remember the rotation or the crop frame.

---

## Optimize tab

The Optimize tab makes web-ready copies of images and videos. The original files do not change.

### Optimize files

1. Select the settings at the top:
   - **Format**: WebP, PNG or JPG for images.
   - **Max width**: 2400, 1600, 1200 or 800 pixels.
   - **Video**: Original, 1080p, 720p or 480p.
2. Drag files or folders from Finder and drop them on the area "Drop files or folders to optimize".
3. The list shows each file with its status: "Queued", "Processing…", a percentage for videos, "Done ✓", "Already exists" or an error.
4. Click **Show in Finder →** on a file to see its result.
5. Click **Clear** to empty the list. Kadar does not stop the work. Files that are not complete come back into the list.

The line above the list shows how many files are complete, for example "3 of 10 complete".

### Where the results go

Kadar puts each result into a folder with the name "optimized", next to the original file. Kadar makes this folder if it does not exist.

The result name comes from the original name: lower case, dashes for spaces, no accents. For example, "photos/My Photo.JPG" becomes "photos/optimized/my-photo.webp".

Sometimes two files in one folder have the same name and a different type, for example "photo.jpg" and "photo.png". Then Kadar adds the type to each result name: "photo-jpg.webp" and "photo-png.webp". Each file gets its own result.

### What happens to images

- Kadar makes images smaller to the max width. It never makes an image larger.
- WebP and JPG use quality 80. PNG is lossless.
- JPG cannot keep transparency. Transparent areas become white.
- Kadar optimizes many images at the same time, on all processor cores.
- Images it accepts: JPG, JPEG, PNG, HEIC, HEIF, WebP, TIFF, BMP, AVIF, camera RAW files and Photoshop (PSD) files. It does not accept GIF or SVG.

### What happens to videos

- Kadar makes an H.264 MP4 file with AAC sound at 128 kb/s.
- The video fits inside the size of the preset: 1080p is 1920 × 1080, 720p is 1280 × 720, 480p is 854 × 480. Original keeps the size. Kadar never makes a video larger.
- Kadar optimizes one video at a time.
- Videos it accepts: MP4, MOV, M4V, MKV, WebM and AVI.

### Folders

When you drop a folder, Kadar optimizes all images and videos in it and in all its subfolders. It does not look into folders with the name "optimized". It ignores hidden files.

### "Already exists"

If the result file is already in the "optimized" folder, Kadar does not make it again. The status shows "Already exists". To make it again, for example with other settings, delete the old result first.

Kadar remembers the Format, Max width and Video settings.

---

## Record tab

The Record tab records a video of one app window or of the entire screen.

### Record a video

1. In **Window**, select an app, or select **Entire screen**.
   - The list shows only apps that have a window on the screen. A minimized window is not in the list.
   - Click the refresh button (the round arrow) to update the list.
2. Optional: resize the window of the app. See "Resize the window" below.
3. In **Audio**, set the sound:
   - **Mic**: select a microphone, or **None**.
   - **Include system sound**: records the sound that your Mac plays. Sounds from Kadar itself are not recorded.
   - **Normalize audio**: makes the sound level even and at a standard loudness.
   - **Raw output**: makes a file with a higher quality, for video editors. The file is larger. It has a fixed 60 frames per second. Its name ends with "-raw".
4. Look at the save folder at the bottom. The default is "~/Movies/Recordings". Click **Change…** to select a different folder.
5. Click **Start Recording**.
6. Kadar counts down 3, 2, 1, with a beep at each number. The number also shows on the Kadar icon in the Dock. Use this time to go to the app that you record.
7. While Kadar records, the tab shows the time and "● Live".
8. Click **Stop**. Kadar shows "Saving…" and a percentage while it makes the MP4 file.
9. The file name shows when the file is ready. Click **Show in Finder** to see it.

### What Kadar records

- With an app selected, Kadar records the largest window of that app.
- With **Entire screen**, Kadar records the main display. The Kadar window is not in the recording.
- The recording has the full Retina resolution and up to 60 frames per second.
- The mouse pointer is in the recording.
- If you record the system sound and a microphone, Kadar mixes them into one sound track.
- The file is an MP4 (H.264 video, AAC sound). Its name is "recording-" and a number, for example "recording-1760000000000.mp4".

Kadar remembers all settings of this tab, also the save folder.

---

## Screenshot tab

The Screenshot tab takes a picture of the window of one app.

### Take a screenshot

1. In **Window**, select an app. The list shows only apps that have a window on the screen. Click the refresh button to update the list.
2. Optional: resize the window of the app. See "Resize the window" below.
3. Set the options:
   - **Format**: PNG or WebP.
   - **Trim**: the number of pixels to remove from each edge (0 to 100). The default is 10.
   - **Scale**: 100%, 75%, 50% or 25%. The default is 50%.
   - **Include window shadow**: keeps the shadow around the window. It is off by default.
4. Look at the save folder at the bottom. The default is "~/Pictures/Screenshots". Click **Change…** to select a different folder.
5. Click **Capture Screenshot**.
6. The file name shows when the file is ready. Click **Show in Finder** to open the save folder.

### What Kadar captures

- Kadar captures the largest window of the app. The window must be visible on the screen.
- Kadar does not play the camera sound.
- Trim is in screen points. On a Retina screen, Kadar removes two times as many image pixels.
- Next to Scale, Kadar shows the size of the result in pixels, for example "→ about 1924 × 1080 px". Kadar uses the size in the size fields and the pixels of your screen. The value is exact after you click **Resize**.
- WebP screenshots use quality 90.
- The file name is "screenshot-" and a number, for example "screenshot-1760000000000.png".

Kadar remembers all settings of this tab, also the save folder.

---

## Resize the window (Record and Screenshot tabs)

Both tabs can give the window of the other app an exact size before you record or capture it.

1. Select the app in **Window**.
2. Select a size: 1944 × 1100, 1920 × 1080, 1280 × 720 or 2560 × 1440.
3. To type a different size, select **Custom…**. Then type the width (400 to 7680) and the height (300 to 4320).
4. Click **Resize**.

Kadar brings the app to the front, sets the size of its front window, and moves it:

- With 1944 × 1100, the window moves to 100 points from the left and 80 points from the top.
- With all other sizes, the window moves to the top-left corner of the screen.

Next to the size, Kadar shows the shape when it is a common one, for example "16:9".

The button shows "Done ✓" when the resize worked, or "Failed" when it did not. Hold the pointer on "Failed" to see the reason.

In the Record tab, the **Resize** button is off when **Entire screen** is selected.

---

## Keys

### Everywhere

| Key | Menu | What it does |
|---|---|---|
| ⌘1 | View › Viewer | Shows the Viewer tab. |
| ⌘2 | View › Optimize | Shows the Optimize tab. |
| ⌘3 | View › Record | Shows the Record tab. |
| ⌘4 | View › Screenshot | Shows the Screenshot tab. |
| ⌃⌘F | View › Enter Full Screen | Shows Kadar on the full screen. |
| ⌘M | Window › Minimize | Minimizes the window. |
| ⌘W | File › Close Window | Closes the window. |
| ⌘H | Kadar › Hide Kadar | Hides Kadar. |
| ⌥⌘H | Kadar › Hide Others | Hides all other apps. |
| ⌘Q | Kadar › Quit Kadar | Quits Kadar. |

Edit › Undo, Copy and Select All act on the text when you type in a field. Otherwise they act on the files in the Viewer, also when you click them with the mouse.

Most commands in the File, Edit, View and Go menus act in the Viewer. If you use one in a different tab, Kadar shows the Viewer tab. Commands that change files (for example Move to Trash or Rename) do not run then. Look at the selection, then use the command again.

While Export for Web is open, the menu commands for the Viewer do not run.

### Viewer: grid

| Key or action | What it does |
|---|---|
| ← → ↑ ↓ | Moves the selection. |
| ⇧ + ← → ↑ ↓ | Makes the selection larger or smaller. |
| Page Up, Page Down | Moves the selection one screen up or down. |
| Home, End | Selects the first or the last tile. |
| ⇧ + Page Up, Page Down, Home, End | Makes the selection larger to that tile. |
| Click | Selects one file. |
| ⌘-click | Adds a file to the selection, or removes it. |
| ⇧-click | Selects all files from the first selected file to this one. |
| ⌘A | Selects all files and subfolders. |
| Esc | Keeps only the last selected file. |
| Double-click, Space | Opens the file in the big view, or opens the subfolder. |
| ⌘I | Opens the file in the big view, with the Info panel. |
| Return | Renames the selected file. |
| ⌘O, ⌘↓ | Opens the files in their default apps. On a subfolder, opens it in Kadar. |
| ⌘R | Shows the file in Finder. |
| ⌘C | Copies the selected files. |
| ⇧⌘C | Copies the paths of the selected files. |
| ⌘E | Opens Export for Web for the selected images. |
| ⇧⌘O | Optimizes the selected files. |
| ⌘⌫ | Moves the selected files to the Trash. |
| ⌘Z | Undoes the last Move to Trash or rename. |
| ⌘↑ | Opens the folder that contains the open folder. |
| ⌘[ | Goes back to the previous folder. |
| ⌘] | Goes forward to the next folder. |
| ⌘F | Puts the cursor in the Filter field. |
| ⌘= | Makes the tiles larger. |
| ⌘- | Makes the tiles smaller. |
| Pinch, ⌘ + scroll | Makes the tiles larger or smaller. |
| Drag a tile | Drags a copy of the selected files to a different app. |
| Right-click | Opens the right-click menu. |

### Viewer: filter field

| Key | What it does |
|---|---|
| Esc | Clears the filter and goes back to the grid. |
| Return, ↓ | Goes back to the grid. The filter stays. |

### Viewer: rename

| Key | What it does |
|---|---|
| Return | Saves the new name. |
| Esc | Cancels. The old name stays. |

### Big view

| Key or action | What it does |
|---|---|
| → | Shows the next file. |
| ← | Shows the previous file. |
| Two-finger swipe left or right | Shows the next or previous file (when the image is not zoomed in). |
| Pinch, ⌘ + scroll | Zooms in or out at the pointer. |
| Double-click the image | Changes between Fit and 100%. |
| 1 | Zooms to 100%. |
| 0 | Fits the image in the window. |
| +, = or ⌘= | Zooms in. |
| - or ⌘- | Zooms out. |
| Drag, scroll | Moves a zoomed image. |
| I, ⌘I | Shows or hides the Info panel. |
| ⌘C | Copies the file. |
| ⇧⌘C | Copies the path of the file. |
| ⌘E | Opens Export for Web for the image. |
| Space | Plays or pauses a video. For an image, closes the big view. |
| Esc, Return | Closes the big view. |

| ⌘Z | Undoes the last Move to Trash or rename. |

These menu keys also work in the big view: ⌘O, ⌘R, ⇧⌘O, ⌘⌫.

### Export for Web

| Key or action | What it does |
|---|---|
| R | Rotates the image right (one image only). |
| Drag inside the crop frame | Moves the frame. |
| Drag an edge or a corner | Changes the size of the frame. |
| Drag on the image in Compare | Moves the line between the original and the result. |
| ⌘C | Copies the result. |
| ⌘S | Saves the result into the "optimized" folder. |
| Esc | Closes Export for Web. |

---

## What Kadar remembers

When you quit Kadar and open it again, Kadar shows the same things:

| Area | What Kadar remembers |
|---|---|
| Window | The size and the position of the window. The tab that was open. |
| Viewer | The open folder. The place in the grid. The selected files. If the big view was open, it opens again on the same file. |
| Viewer | The open folders in the sidebar. The favorites. |
| Viewer | The sort order and its direction. The filter text (until you open a different folder). The thumbnail size. |
| Big view | If the Info panel was open. |
| Export for Web | The crop shape, width, format and quality. |
| Optimize | The format, the max width and the video setting. |
| Record | The window, the size, the microphone, all check boxes and the save folder. |
| Screenshot | The window, the size, the format, the trim, the scale, the shadow and the save folder. |

Kadar also keeps the thumbnails and the camera dates on disk. Large folders then open faster the next time.

Kadar does **not** remember these things after you quit:

- the Undo steps,
- the Back and Forward history of folders,
- the list in the Optimize tab.

### Open files from Finder

Kadar can open images and videos from Finder:

- Right-click a file or a folder in Finder, choose **Open With**, then choose **Kadar**.
- Drop images, videos or a folder on the Kadar icon in the Dock.

For a folder, Kadar opens that folder. For files, Kadar shows the folder of the file, selects the files and shows the first one in the big view. If the filter hides that file, Kadar clears the filter. If Kadar is not open, it starts with these files.

---

## Files Kadar opens

The Viewer shows these files. It does not show other files and hidden files (files with a name that starts with a dot).

| Type | File extensions |
|---|---|
| Images | JPG, JPEG, PNG, WebP, GIF, AVIF, BMP, TIF, TIFF, SVG, HEIC, HEIF |
| Camera RAW | DNG, CR2, CR3, CRW, NEF, NRW, ARW, SRF, SR2, RAF, ORF, RW2, RWL, PEF, SRW, 3FR, IIQ, ERF, MOS, MRW, X3F |
| Photoshop | PSD |
| Videos | MP4, MOV, M4V, WebM |

For camera RAW and Photoshop files, the big view shows a JPG preview that macOS makes. Kadar makes this preview once and keeps it.

In Finder, Kadar shows in **Open With** for these types: JPG, JPEG, PNG, HEIC, HEIF, WebP, GIF, TIF, TIFF, BMP, AVIF, DNG, CR2, CR3, NEF, ARW, RAF, ORF, RW2, PEF, SRW, PSD, MP4, MOV, M4V and WebM.

---

## Troubleshooting

| Problem | What to do |
|---|---|
| The Record or Screenshot tab shows a warning about Screen Recording. | Click **Open Settings**. Turn on Kadar in Screen Recording. Then quit Kadar and open it again. |
| "The screenshot is empty." | Kadar does not have the Screen Recording permission. Allow it as in the row above. |
| "No open window found for …" | The app has no visible window. Open a window of the app. Do not minimize it. Click the refresh button and select the app again. |
| The Screenshot window list shows "No apps found". | No app has a window on the screen. Open a window, then click the refresh button. |
| "Kadar cannot use the microphone." | Open **System Settings › Privacy & Security › Microphone** and turn on Kadar. Or select **None** in Mic. |
| "Recording stopped: …" | macOS stopped the recording. The reason follows the colon. Start the recording again. |
| "A recording is already running." | Click **Stop** to end the current recording first. |
| **Resize** shows "Failed". | Hold the pointer on the button to see the reason. Allow Kadar in **System Settings › Privacy & Security › Accessibility** and **Automation** (System Events). |
| The Optimize list shows "Already exists". | The result is already in the "optimized" folder. Delete the old result to make it again. |
| "Rename failed: … already exists in this folder." | Type a different name. |
| "Rename failed: This name is not allowed." | Do not use a slash (/), and do not use an empty name. |
| "Undo failed: … already exists." | A new file with the same name is in the folder. Kadar does not write over it. Get the old file from the Trash in Finder. |
| The count shows "(truncated)". | The folder has more than 50,000 items. Kadar shows only the first 50,000. Move files into subfolders. |
| A file is not in the grid. | Kadar does not show that file type, or the filter hides it. Press **Esc** in the Filter field to clear it. |
| "Export for Web…" is gray in the right-click menu. | No image is selected. Export for Web does not use videos or folders. |
| Export for Web shows "Kadar cannot read this image." | The file is damaged, or macOS cannot read its format. Open it in another app to check. |
| "Something failed: …" | An unexpected error occurred. Try the action again. If it fails again, note the text and report it. |

---

## Kadar on Windows

Kadar on Windows is new. The Viewer, Optimize (images) and Export for Web work. Video optimizing, dragging files out, Record and Screenshot come later.

- Kadar on Windows has no menu bar. Use the keys below, or right-click a file.
- Use **Ctrl** where this guide says **⌘**.
- "Finder" is **File Explorer**, the "Trash" is the **Recycle Bin**, and "Movies" is **Videos**.
- For HEIC photos and camera RAW files, Windows needs Microsoft's free **HEIF Image Extensions** and **Raw Image Extension** from the Microsoft Store.

| Key | What it does |
|---|---|
| Ctrl+1, Ctrl+2 | Shows the Viewer or the Optimize tab. |
| Ctrl+O | Opens the selected files in their default app. |
| Ctrl+R | Shows the file in File Explorer. |
| Ctrl+E | Opens Export for Web. |
| Ctrl+Shift+O | Optimizes the selected files. |
| Delete or Ctrl+Backspace | Moves the selected files to the Recycle Bin. |
| F2 or Return | Renames the selected file. |
| Ctrl+Z | Undoes the last move to the Recycle Bin or rename. |
| Ctrl+C / Ctrl+Shift+C | Copies the files / their paths. |
| Ctrl+A | Selects all files. |
| Ctrl+F | Goes to the filter field. |
| Ctrl+I | Shows or hides the info panel. |
| Ctrl+= / Ctrl+- | Makes the tiles larger / smaller. |
| Alt+← or Ctrl+[ | Goes back to the previous folder. |
| Alt+→ or Ctrl+] | Goes forward. |
| Alt+↑ or Ctrl+↑ | Opens the folder that contains the open folder. |

