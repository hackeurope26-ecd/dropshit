export async function prepareCandidateForAI(resultDict) {
  if (!resultDict?.image || !resultDict?.link) {
    throw new Error("Invalid reverse search result object");
  }

  const { title, link, source, image, image_width, image_height } = resultDict;

  // Download candidate image
  const imageResponse = await fetch(image);
  if (!imageResponse.ok) {
    throw new Error(`Failed to download candidate image: ${imageResponse.status}`);
  }

  // ✅ btoa() works in service workers, Buffer does not
  const imageBuffer = new Uint8Array(await imageResponse.arrayBuffer());
  let imageBinary = '';
  for (let i = 0; i < imageBuffer.byteLength; i++) imageBinary += String.fromCharCode(imageBuffer[i]);
  const base64Image = btoa(imageBinary);

  let pageTitle = null;
  let detectedPrice = null;

  try {
    const pageResponse = await fetch(link);
    if (pageResponse.ok) {
      const html = await pageResponse.text();
      const titleMatch = html.match(/<title>(.*?)<\/title>/i);
      pageTitle = titleMatch ? titleMatch[1] : null;
      const priceMatch = html.match(/\$\s?\d+(?:\.\d{2})?/);
      detectedPrice = priceMatch ? priceMatch[0] : null;
    }
  } catch {
    // non-fatal — proceed without page metadata
  }

  return {
    metadata: {
      originalTitle: title || null,
      pageTitle,
      domain: new URL(link).hostname,
      source,
      detectedPrice,
      imageUrl: image,
      pageUrl: link,
      imageDimensions: { width: image_width || null, height: image_height || null }
    },
    imageBase64: base64Image,
    imageMimeType: imageResponse.headers.get("content-type") || "image/jpeg"
  };
}
