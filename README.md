# Scene Framer - ComfyUI Custom Node

Scene Framer is a simple utility node for framing multiple shots from a single image.

It lets you load a background or panorama image and define several crop areas directly inside the node. Each crop becomes a separate image output that can be used anywhere in your ComfyUI workflow.

This is useful when you want to extract different views of the same scene without creating multiple crop nodes or duplicating workflows.


---

## What This Node Does

Normally, if you want several cropped versions of the same image in ComfyUI, you need to:

- create multiple crop nodes  
- duplicate parts of your workflow  
- manage many nodes for simple shot framing  

Scene Framer simplifies this.

You can visually define several shot areas directly on the image, and each one becomes its own output.

This keeps the workflow cleaner and easier to manage, especially when working with multiple shots from the same environment image.

---

## Features

**Interactive Shot Framing**  
Drag and resize crop areas directly on the image.

**Multiple Shots from One Image**  
Create up to 8 different shots from a single background or panorama image.

**Add or Remove Shots as Needed**  
Enable only the shots you want to use.

**Color-Coded Shot Boxes**  
Each shot is color coded, making it easier to identify and manage.

**Separate Output per Shot**  
Every shot outputs as its own image socket.

**Custom Output Resolution**  
Each shot can be resized to a different resolution if needed.

---

## Example Workflow

An example workflow is included in the repository.


