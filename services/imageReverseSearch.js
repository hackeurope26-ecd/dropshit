// Routes through the proxy — no CORS issues, no loadEnv in browser
export async function searchImageWithSerpApi(imageUrl) {
  if (!imageUrl) throw new Error("imageUrl is required");

  const response = await fetch("http://localhost:3000/lens", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageUrl })
  });

  if (!response.ok) throw new Error(`Lens proxy failed: ${response.status}`);

  const data = await response.json();
  console.log("[imageReverseSearch] result:", data);
  return data;
}
