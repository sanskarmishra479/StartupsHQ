import {
  categoryMetadata,
  categoryPage,
  categoryStaticParams,
} from "../../../_lib/category-route";

// FR-108: /categories/locations/cities/[slug].

export const generateStaticParams = categoryStaticParams("cities");
export const generateMetadata = categoryMetadata("cities");
export default categoryPage("cities");
